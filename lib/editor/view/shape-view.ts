import { SkyBaseLayerView, SkyTextView } from '.';
import {
  SkyShapeGroup,
  SkyBaseShapeLike,
  SkyFill,
  SkyFillType,
  SkyGradientType,
  SkyShadow,
  SkyBorder,
  SkyBorderPosition,
  SkyBorderOptions,
  SkyGradient,
  SkyPatternFillType,
  SkyGraphicsContextSettings,
} from '../model';
import { Rect, degreeToRadian, Disposable } from '../base';
import sk, { SkCanvas, SkPath, SkShader, SkPaint } from '../util/canvaskit';
import { convertRadiusToSigma } from '../util/sketch-to-skia';
import { createPath } from '../util/path';
import { CacheGetter } from '../util/misc';

type SkyBasePath = SkyShapeGroup | SkyBaseShapeLike;
export abstract class SkyBasePathView<T extends SkyBasePath = SkyBasePath> extends SkyBaseLayerView<T> {
  children!: (SkyShapePathLikeView | SkyTextView)[];
  path?: SkPath;
  _painter?: PathPainter;

  scaleOffsetX = 0;
  scaleOffsetY = 0;

  private _appliedSymbolScale = false;

  constructor(model: T) {
    super(model);

    this.path = this.createPath();
  }

  protected abstract createPath(): SkPath | undefined;

  // 应用了当前 frame x,y rotation ,flip 状态的 path
  // 1 在 instance 内拉伸时，需要计算 bounds 这个时候会用到
  // 2 在 shapeGroup 进行 boolean op 时也应该用应用了 transform 的
  // Todo 优化下避免重复计算
  // @CacheGetter<SkyBaseLayerView>((ins) => ins.layerUpdateId)
  get pathWithTransform() {
    const intrinsicFrame = this.intrinsicFrame;
    const { rotation, isFlippedHorizontal, isFlippedVertical } = this.model;
    if (rotation || isFlippedHorizontal || isFlippedVertical) {
      const flipX = isFlippedHorizontal ? -1 : 1;
      const flipY = isFlippedVertical ? -1 : 1;

      // 为什么外面那个 radian 不需要乘上 flip？这里又需要
      // 我虽然试出来了，但我并没有搞明白为什么
      const radian = -1 * flipX * flipY * degreeToRadian(rotation);

      const transform = sk.CanvasKit.Matrix.multiply(
        sk.CanvasKit.Matrix.translated(intrinsicFrame.x, intrinsicFrame.y),
        sk.CanvasKit.Matrix.rotated(radian, intrinsicFrame.width / 2, intrinsicFrame.height / 2),
        sk.CanvasKit.Matrix.scaled(flipX, flipY, intrinsicFrame.width / 2, intrinsicFrame.height / 2)
      );
      return this.path?.copy().transform(transform);
    } else {
      return this.path?.copy().offset(intrinsicFrame.x, intrinsicFrame.y);
    }
  }

  /**
   * shape 需要矢量拉伸，以确保 border 不变形
   */
  private applySymbolScale() {
    const info = this.calcInstanceChildScale();
    if (info) {
      const { scaleX, scaleY } = info;
      const { rotation, isFlippedHorizontal, isFlippedVertical } = this.model;

      const flipX = isFlippedHorizontal ? -1 : 1;
      const flipY = isFlippedVertical ? -1 : 1;

      // flipX * flipY
      const radian = -1 * degreeToRadian(rotation);

      const intrinsicFrame = this.intrinsicFrame;

      // 计算出 scale 前 shape 受 rotate、flip 影响后的真实的 bounds

      let transformedBounds = intrinsicFrame;
      const { pathWithTransform } = this;
      if (pathWithTransform) {
        transformedBounds = Rect.fromSk(pathWithTransform.getBounds());
      }

      const transform = sk.CanvasKit.Matrix.multiply(
        // sk.CanvasKit.Matrix.identity(),
        sk.CanvasKit.Matrix.scaled(scaleX * flipX, scaleY * flipY),
        sk.CanvasKit.Matrix.rotated(radian)
      );
      this.path = this.path?.transform(transform);

      const bounds = this.path?.getBounds();

      const newFrame = bounds ? Rect.fromSk(bounds) : this.intrinsicFrame;

      const { newX, newY } = this.calcOffsetAfterScale(newFrame, transformedBounds);

      // 完全重新计算偏移，这里 offset 实际上不是修正，而是 lef top 的 position
      this.scaleOffsetX = newX - newFrame.x;
      this.scaleOffsetY = newY - newFrame.y;

      this.scaledFrame = newFrame;

      this._appliedSymbolScale = true;
    } else {
      this._appliedSymbolScale = false;
    }
  }

  // @CacheGetter<SkyBaseLayerView>((ins) => ins.layerUpdateId)
  get renderFrame() {
    // 在没有应用 stroke/shadow/blur 扩散时的 frame
    // 这里都将转换到自身应用了 transform 的情况。
    // scaledFrame 中 x，y 没有放在 transform 中。 而 intrinsicFrame 的则放在了  transform 中。
    const rawFrame = this._appliedSymbolScale ? this.scaledFrame! : this.intrinsicFrame.onlySize;
    return this.model.inflateFrame(rawFrame);
  }

  // @CacheGetter<SkyBaseLayerView>((ins) => ins.layerUpdateId)
  get svgBuildInfo() {
    const path = this.pathWithTransform;
    if (!path) return;
    return {
      path: path.toSVGString(),
      bounds: Rect.fromSk(path.getBounds()),
    };
  }

  updateTransform() {
    if (this._appliedSymbolScale) {
      this.transform.position.set(this.scaleOffsetX, this.scaleOffsetY);
      this.transform.updateLocalTransform();
    } else {
      super.updateTransform();
    }
  }

  layoutSelf() {
    // shapeGroup 下的 children 不需要
    if (!(this.parent instanceof SkyShapeGroupView)) {
      this.applySymbolScale();
    }
  }

  _render() {
    if (!this._painter) {
      this._painter = new PathPainter(this);
    }

    this._painter.paint();
  }

  _tryClip() {
    const { skCanvas } = this.ctx;
    if (this.path) {
      skCanvas.clipPath(this.path, sk.CanvasKit.ClipOp.Intersect, true);
    }
  }
}

export class SkyShapeGroupView extends SkyBasePathView<SkyShapeGroup> {
  children!: (SkyShapePathLikeView | SkyTextView)[];
  path?: SkPath;

  /**
   * combine children
   */
  protected createPath() {
    if (!this.children.length) return;

    const firstChild = this.children[0];
    let ret = firstChild.pathWithTransform;
    if (this.children.length === 1) return ret;

    if (!ret) return;

    ret = ret.copy();
    // const { frame } = firstChild;
    // ret.offset(frame.x, frame.y);

    this.children.slice(1).reduce((resultPath: SkPath | undefined, child: SkyShapePathLikeView | SkyTextView) => {
      const opPath = child.pathWithTransform;
      // const { frame } = child;

      // 如果有一个无法转换成 path 就暂停
      if (!resultPath || !opPath) return undefined;

      // opPath.offset(frame.x, frame.y);
      // try {
      resultPath.op(opPath, child.model.booleanOperation);
      // } catch (err) {
      //   console.log('>?>>>', err);
      // }
      // switch()
      return resultPath;
    }, ret);

    return ret;
  }
}

export class SkyShapePathLikeView extends SkyBasePathView<SkyBaseShapeLike> {
  protected createPath() {
    return createPath(this.model.points, this.model.isClosed);
  }
}

export class PathPainter extends Disposable {
  private paintFnArr = [] as (() => void)[];
  private shadowPath?: SkPath | null;

  // 一个 calculated 的状态，没太大用。
  private hasFill = false;

  constructor(private view: SkyBasePathView | SkyTextView) {
    super();
    this.calcShadowPath();
    this.calcPaintInfo();
  }

  get skCanvas() {
    return this.view.ctx.skCanvas;
  }

  get style() {
    return this.view.model.style;
  }

  get frame() {
    return this.view.frame;
  }

  get model() {
    return this.view.model;
  }

  get path() {
    return this.view.path;
  }

  paint() {
    this.paintFnArr.forEach((fn) => fn());
  }

  /**
   * 计算用于渲染 shadow 的 path
   *
   * 1 如果只有 fill，直接返回原来的 path
   * 2 如果有 fill 和 stroke，选择占外部thickness最多的合并
   * 3 如果所有 fill 都不生效， 所有 stroke 合并在一起
   * 4 如果所有 fill 不生效，并且 所有 border 也不生效，用原来的 path 渲染 shadow ，并且不设置 clip。
   * 5 如果 path 非闭合，border 叠加进行渲染。 如果无 border，则无 shadow。
   */
  private calcShadowPath() {
    if (!this.path) return;

    const fills = this.model.style?.fills;
    const borders = this.model.style?.borders;

    const hasFill = fills?.some((fill) => fill.isEnabled);
    const hasBorder = borders?.some((border) => border.isEnabled);

    this.hasFill = !!hasFill;

    // 计算所有的 border 叠加的情况下，内外分别延伸多少
    let inside = 0;
    let outside = 0;
    borders
      ?.filter((border) => border.isEnabled && border.thickness > 0)
      .forEach((border) => {
        const { thickness, position } = border;
        if (position === SkyBorderPosition.Inside) {
          inside = Math.max(inside, thickness);
        } else if (position === SkyBorderPosition.Outside) {
          outside = Math.max(outside, thickness);
        } else {
          // center
          inside = Math.max(inside, thickness / 2);
          outside = Math.max(outside, thickness / 2);
        }
      });

    if (hasFill && hasBorder) {
      if (outside) {
        this.shadowPath = this.path.copy().stroke({ width: outside * 2 });
        this.shadowPath?.op(this.path, sk.CanvasKit.PathOp.Union);
      } else {
        this.shadowPath = this.path;
      }
    } else if (hasFill) {
      // 只有 fill
      this.shadowPath = this.path;
    } else if (hasBorder) {
      // 只有 border

      // 所有的 border 进行个合并

      if (inside !== 0 && outside !== 0) {
        // 内外都占

        if (inside === outside) {
          // 比较简单，居中的 border
          this.shadowPath = this.path.copy().stroke({ width: inside * 2 });
        } else {
          // 比较复杂， 内外不一样的 border 厚度

          const insideBorder = this.path.copy().stroke({ width: inside * 2 });
          insideBorder?.op(this.path, sk.CanvasKit.PathOp.Intersect);

          const outsideBorder = this.path.copy().stroke({ width: outside * 2 });
          outsideBorder?.op(this.path, sk.CanvasKit.PathOp.Difference);

          if (insideBorder && outsideBorder) {
            insideBorder.op(outsideBorder, sk.CanvasKit.PathOp.Union);
            this.shadowPath = insideBorder;
            outsideBorder.delete();
          }
        }
      } else if (inside !== 0) {
        // 只有 inside
        this.shadowPath = this.path.copy().stroke({ width: inside * 2 });
        this.shadowPath?.op(this.path, sk.CanvasKit.PathOp.Intersect);
      } else if (outside !== 0) {
        // 只有 outside
        this.shadowPath = this.path.copy().stroke({ width: outside * 2 });
        this.shadowPath?.op(this.path, sk.CanvasKit.PathOp.Difference);
      } else {
        // border 宽度都是 0，相当于没有 border
        this.shadowPath = this.path;
      }
    } else {
      // border fill 都没有，不用 clip
      this.shadowPath = this.path;
    }
  }

  private calcPaintInfo() {
    const { skCanvas, path, frame, style } = this;

    if (!path) {
      console.log(`No path created`, this.view.debugString());
      return;
    }

    // out shadow 在底部，先绘制
    const shadows = style?.shadows;
    if (shadows) {
      for (let i = 0; i < shadows.length; i++) {
        if (shadows[i].isEnabled) {
          this.paintShadow(shadows[i]);
        }
      }
    }

    const fills = style?.fills;

    if (fills) {
      for (let i = 0; i < fills.length; i++) {
        if (fills[i].isEnabled) {
          this.paintFill(skCanvas, path, fills[i], frame);
        }
      }
    }

    // inner shadow 在 fill 上，但在 border 之下
    const innerShadows = style?.innerShadows;
    if (innerShadows) {
      for (let i = 0; i < innerShadows.length; i++) {
        if (innerShadows[i].isEnabled) {
          this.paintShadow(innerShadows[i]);
        }
      }
    }

    const borders = style?.borders;

    if (borders) {
      for (let i = 0; i < borders.length; i++) {
        if (borders[i].isEnabled && borders[i].thickness) {
          this.paintBorder(skCanvas, path, borders[i], frame);
        }
      }
    }
  }

  private paintFill(canvas: SkCanvas, path: SkPath, fill: SkyFill, frame: Rect) {
    const paint = new sk.CanvasKit.Paint();

    if (fill.fillType === SkyFillType.Color) {
      paint.setColor(fill.color.skColor);
    } else if (fill.fillType === SkyFillType.Gradient && fill.gradient) {
      this.applyGradient(paint, fill.gradient, frame);
    } else if (fill.fillType === SkyFillType.Pattern) {
      this.applyImageFill(paint, fill, frame);
    }

    this.applyContextSettings(paint, fill.contextSettings);

    this.paintFnArr.push(() => {
      const skCanvas = this.skCanvas;
      skCanvas.drawPath(path, paint);
    });
    this._disposables.push(() => {
      paint.delete();
    });
    return;
  }

  /**
   * 绘制 border，还是需要用 stroke 的方式，这样才能应用 dash、joint 等设置
   * @param canvas
   * @param path
   * @param border
   * @param frame
   */
  private paintBorder(canvas: SkCanvas, path: SkPath, border: SkyBorder, frame: Rect) {
    // skia 的 stroke 只能以居中的方式进行绘制
    // 如果 border 在 center 不需要任何调整
    // 否则将 strokeWidth * 2， 再在绘制的时候应用 clip
    // 如果 border 为 inside，clip 选择 intersect
    // 如果 border 为 outside，clip 选择 difference

    const borderOptions = this.style?.borderOptions;
    const paint = new sk.CanvasKit.Paint();

    if (border.fillType === SkyFillType.Color) {
      paint.setColor(border.color.skColor);
    } else if (border.fillType === SkyFillType.Gradient && border.gradient) {
      this.applyGradient(paint, border.gradient, frame);
    } else {
      console.log('Not supported border fill type:', border.fillType, SkyFillType[border.fillType]);
    }

    paint.setStyle(sk.CanvasKit.PaintStyle.Stroke);

    const isCenter = border.position === SkyBorderPosition.Center;

    paint.setStrokeWidth(border.thickness * (isCenter ? 1 : 2));
    this.applyBorderOptions(paint, borderOptions);
    this.applyContextSettings(paint, border.contextSettings);

    this.paintFnArr.push(() => {
      const skCanvas = this.skCanvas;
      if (!isCenter) {
        skCanvas.save();
        skCanvas.clipPath(
          path,
          border.position === SkyBorderPosition.Inside ? sk.CanvasKit.ClipOp.Intersect : sk.CanvasKit.ClipOp.Difference,
          true
        );
      }
      skCanvas.drawPath(path, paint);
      if (!isCenter) {
        skCanvas.restore();
      }
    });
    this._disposables.push(() => {
      paint.delete();
    });
  }

  /**
   * shadow 的问题
   * 0 inner shadow 和 outer shadow 都要设置 clip
   * 1 [*] path，应该是结合了 border 和 fill 的。
   * 2 [*] path 在没有 fill 的时候，只有 border 。 只以 border path 为准。
   * 3 [*] out shadow 在 stroke/fill 之前。 inner 在之后，并且要 clip
   * 4 [*] outer spread 要基于border/fill合并后的path做膨胀。 inner path 可以继续用原始 fill 的 path。
   * 5 [*] offset
   * 6 text image shadow 问题
   * 7 [*] inner shadow, 只跟原始形状有关，不需要再做计算。(sketch 是这么实现的，但 figma 并不是，我认为 figma 的才是对的)。
   */
  private paintShadow(shadow: SkyShadow) {
    if (shadow.isEmpty) return;
    // 实际上用于绘制的 shadow path。 this.shadowPath 主要是 outer shadow 用。 inner shadow 直接用 this.path 即可。
    let actualShadowPath: SkPath | null | undefined;
    let clipPath: SkPath | null | undefined;

    if (shadow.isInner) {
      if (!this.path) return;
      // 在 inner shadow 的情况下，sketch 不需要使用计算出来的 shadowPath, figma 则还是会使用和 outer shadow 一致的 shadowPath.
      // 此处跟 sketch 保持一致，虽然我觉得 figma 的做法更好。

      actualShadowPath = this.path.copy();
      actualShadowPath.setFillType(sk.CanvasKit.FillType.InverseEvenOdd);

      // inverseEvenOdd 类型的 path 区域可能无限大。 设置了 maskFilter 后，skia 做了优化限制了大小。
      // 存在 offset 的时候需要主动添加点内容，以扩充区域
      if (shadow.offsetX || shadow.offsetY) {
        const bounds = Rect.fromSk(this.path.getBounds());
        const x =
          shadow.offsetX > 0
            ? bounds.x - shadow.offsetX - shadow.blurRadius - 1
            : bounds.right - shadow.offsetX + shadow.blurRadius;
        const y =
          shadow.offsetY > 0
            ? bounds.y - shadow.offsetY - shadow.blurRadius - 1
            : bounds.bottom - shadow.offsetY + shadow.blurRadius;

        actualShadowPath.addRect(sk.CanvasKit.XYWHRect(x, y, 1, 1));
      }

      if (shadow.spread) {
        const temp = actualShadowPath;
        actualShadowPath = this.path.copy().stroke({ width: shadow.spread * 2 });
        actualShadowPath?.op(temp, sk.CanvasKit.PathOp.Union);
        temp.delete();
      }

      clipPath = this.path;
    }

    if (!shadow.isInner) {
      if (!this.shadowPath) return;
      actualShadowPath = this.shadowPath;
      if (shadow.spread) {
        // expand
        const spreadPath = this.shadowPath.copy().stroke({ width: this.hasFill ? shadow.spread * 2 : shadow.spread });
        spreadPath?.op(this.shadowPath, sk.CanvasKit.PathOp.Union);
        actualShadowPath = spreadPath;
      }
      // outside shadow 在有 fill 的时候需要 clip，这样透明的 fill 背后才会是空白的。
      if (this.hasFill) {
        clipPath = this.shadowPath;
      }
    }

    if (!actualShadowPath) return;

    const paint = new sk.CanvasKit.Paint();
    paint.setColor(shadow.color.skColor);
    this.applyContextSettings(paint, shadow.contextSettings);
    const sigma = convertRadiusToSigma(shadow.blurRadius);
    paint.setMaskFilter(sk.CanvasKit.MaskFilter.MakeBlur(sk.CanvasKit.BlurStyle.Normal, sigma, true));

    this.paintFnArr.push(() => {
      const skCanvas = this.skCanvas;
      skCanvas.save();
      if (clipPath) {
        if (shadow.isInner) {
          skCanvas.clipPath(clipPath, sk.CanvasKit.ClipOp.Intersect, true);
        } else {
          skCanvas.clipPath(clipPath, sk.CanvasKit.ClipOp.Difference, true);
        }
      }

      skCanvas.translate(shadow.offsetX, shadow.offsetY);

      skCanvas.drawPath(actualShadowPath!, paint);

      skCanvas.restore();
    });

    this._disposables.push(() => {
      if (actualShadowPath !== this.path && actualShadowPath !== this.shadowPath) {
        actualShadowPath?.delete();
      }
      if (clipPath !== this.path && clipPath !== this.shadowPath) {
        clipPath?.delete();
      }
      paint.delete();
    });
  }

  private applyGradient(paint: SkPaint, gradient: SkyGradient, frame: Rect) {
    let shader: SkShader | undefined;
    const fromPoint = gradient.from.scaleNew(frame.width, frame.height);
    const toPoint = gradient.to.scaleNew(frame.width, frame.height);

    const colors = [] as Float32Array[];
    const stops = [] as number[];

    gradient.stops.forEach((stop) => {
      colors.push(stop.color.skColor);
      stops.push(stop.position);
    });

    if (gradient.gradientType === SkyGradientType.Linear) {
      shader = sk.CanvasKit.Shader.MakeLinearGradient(
        fromPoint.toArray(),
        toPoint.toArray(),
        colors,
        stops,
        sk.CanvasKit.TileMode.Clamp
      );
    }

    // Todo
    // eclipse 的情况怎么处理
    if (gradient.gradientType === SkyGradientType.Radial) {
      shader = sk.CanvasKit.Shader.MakeRadialGradient(
        fromPoint.toArray(),
        fromPoint.distanceTo(toPoint),
        colors,
        stops,
        sk.CanvasKit.TileMode.Clamp
      );
    }

    // 有点问题
    if (gradient.gradientType === SkyGradientType.Angular) {
      shader = sk.CanvasKit.Shader.MakeSweepGradient(
        fromPoint.x,
        fromPoint.y,
        colors,
        stops,
        sk.CanvasKit.TileMode.Clamp
      );
    }

    if (shader) {
      paint.setShader(shader);
    }
  }

  private applyBorderOptions(paint: SkPaint, option?: SkyBorderOptions) {
    if (!option?.isEnabled) return;
    if (option.dashPattern.length) {
      const dashEffect = sk.CanvasKit.PathEffect.MakeDash(option.dashPattern);
      paint.setPathEffect(dashEffect);
    }
    paint.setStrokeCap(option.lineCapStyle);
    paint.setStrokeJoin(option.lineJoinStyle);
  }

  private applyContextSettings(paint: SkPaint, contextSettings?: SkyGraphicsContextSettings) {
    paint.setAntiAlias(true);
    if (contextSettings) {
      const { opacity, blendMode } = contextSettings;
      if (opacity !== 1) {
        paint.setAlphaf(opacity);
      }
      if (blendMode !== sk.CanvasKit.BlendMode.Src) {
        paint.setBlendMode(blendMode);
      }
    }
  }

  private applyImageFill(paint: SkPaint, fill: SkyFill, frame: Rect) {
    const skImg = fill.image?.skImage;
    if (!skImg) {
      return;
    }

    let shader: SkShader;

    // repeat
    if (fill.patternFillType === SkyPatternFillType.Tile) {
      const { patternTileScale } = fill;
      const matrix = sk.CanvasKit.Matrix.scaled(patternTileScale, patternTileScale);
      shader = skImg.makeShaderOptions(
        sk.CanvasKit.TileMode.Repeat,
        sk.CanvasKit.TileMode.Repeat,
        sk.CanvasKit.FilterMode.Nearest,
        sk.CanvasKit.MipmapMode.None,
        matrix
      );
    } else {
      // 非 repeat 的情况
      let matrix: number[] | undefined;

      const imgWidth = skImg.width();
      const imgHeight = skImg.height();

      const { width, height } = frame;

      const ratioX = width / imgWidth;
      const ratioY = height / imgHeight;

      const imgAsp = imgWidth / imgHeight;
      const frameAsp = width / height;

      // 图片相对 frame
      const isThin = imgAsp < frameAsp;

      // stretch
      // 宽高按比例拉伸即可
      if (fill.patternFillType === SkyPatternFillType.Stretch) {
        matrix = sk.CanvasKit.Matrix.scaled(ratioX, ratioY);
      } else {
        let fitWidth = false;

        // fill
        // 一边对齐，另一边超出
        if (fill.patternFillType === SkyPatternFillType.Fill) {
          if (isThin) {
            // 宽度对齐，高度超出
            fitWidth = true;
          } else {
            // 高度对齐，宽度超出
            fitWidth = false;
          }
        }

        // fit
        // 一边对齐，另一边不足
        if (fill.patternFillType === SkyPatternFillType.Fit) {
          if (isThin) {
            // 高度对齐，宽度不足
            fitWidth = false;
          } else {
            // 宽度对齐， 高度不足
            fitWidth = true;
          }
        }

        if (fitWidth) {
          const scale = ratioX;
          const paintHeight = imgHeight * scale;
          const yOffset = -(paintHeight - height) / 2;
          matrix = sk.CanvasKit.Matrix.multiply(
            sk.CanvasKit.Matrix.translated(0, yOffset),
            sk.CanvasKit.Matrix.scaled(scale, scale)
          );
        } else {
          // fitHeight
          const scale = ratioY;
          const paintWidth = imgWidth * scale;
          const xOffset = -(paintWidth - width) / 2;

          matrix = sk.CanvasKit.Matrix.multiply(
            sk.CanvasKit.Matrix.translated(xOffset, 0),
            sk.CanvasKit.Matrix.scaled(scale, scale)
          );
        }
      }

      shader = skImg.makeShaderOptions(
        sk.CanvasKit.TileMode.Decal,
        sk.CanvasKit.TileMode.Decal,
        sk.CanvasKit.FilterMode.Nearest,
        sk.CanvasKit.MipmapMode.None,
        matrix
      );
    }

    if (shader) {
      paint.setShader(shader);
    }
  }

  dispose() {
    super.dispose();
    this.paintFnArr.length = 0;
    if (this.shadowPath !== this.path) {
      this.shadowPath?.delete();
    }
  }
}
