import path from 'path';
import ForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
require('dotenv').config();


// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: true },
  vite: {
    define: {
      'process.env.PUBLIC_PATH': JSON.stringify('/')
    }
  },  
  // runtimeConfig: {
  //   NODE_ENV: 'development',
  //   // The private keys which are only available server-side
  //   NUXT_API_SECRET:'123',
  //   apiSecret: '123',
  //   // Keys within public are also exposed client-side
  //   public: {
  //     apiBase: '/api'
  //   }
  // },  
  css: ['~/assets/global.css', 'vue3-perfect-scrollbar/dist/vue3-perfect-scrollbar.css'],
  plugins: ['~/plugins/config.client.ts'],
  modules: ['nuxt-svgo']  
  // build: {
  //   extend(config, { isDev, isClient }) {
  //     if (isClient) {
  //       config.module.rules.push(require.resolve('./svg-sprite.js'));
  //     }
  //   }
  // }
  // modules: [
  //   (configs, nuxt) => {
  //     nuxt.hook('webpack:config', (configs) => {
  //       configs.forEach((config) => {
  //         (config.resolve || (config.resolve = {})).fallback = {
  //           path: false,
  //           fs: false,
  //         };

  //         const svgCompDir = path.join(__dirname, 'assets/svg-comp');

  //         config.module?.rules?.forEach((rule) => {
  //           if (typeof rule === 'object' && rule.test instanceof RegExp)
  //             if (rule.test.test('.svg')) {
  //               rule.exclude = [svgCompDir];
  //             }
  //         });
          
  //         config.module?.rules?.push({
  //           test: /\.svg$/,
  //           include: [svgCompDir],
  //           use: [
  //             'vue-loader',
  //             path.resolve('./scripts/svg-comp-loader.js'),
  //             'svg-sprite-loader',
  //             {
  //               loader: 'svgo-loader',
  //               options: {
  //                 plugins: [
  //                   {
  //                     name: 'convertColors',
  //                     params: { currentColor: true },
  //                   },
  //                 ],
  //               },
  //             },
  //           ],
  //         });
  //       });
  //     });
  //   },
  //   ,
  // ],
});

// export default defineNuxtConfig({
//   ssr: false,
//   css: ['~/assets/global.css', 'vue3-perfect-scrollbar/dist/vue3-perfect-scrollbar.css'],
//   plugins: ['~/plugins/config.client.ts'],    
//   build: {
//     // extend(config) {
//     //   console.log('>>>> got config');
//     //   process.exit();
//     //   const node = config.node || (config.node = {});
//     //   node.fs = 'empty';
//     //   config.module.rules.push({
//     //     test: /.wasm/i,
//     //     type: 'javascript/auto',
//     //   });
//     // },
//   },
// });