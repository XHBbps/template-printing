import 'element-plus/dist/index.css';
import './styles/theme.css';

import ElementPlus from 'element-plus';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
// eslint-disable-next-line import/no-unresolved
import router from './router/index.js';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(ElementPlus);
app.mount('#app');
