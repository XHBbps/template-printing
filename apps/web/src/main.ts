import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
// eslint-disable-next-line import/no-unresolved
import router from './router/index.js';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
