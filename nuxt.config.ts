// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: true }
})

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