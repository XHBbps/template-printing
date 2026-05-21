import 'element-plus/dist/index.css';
import './styles/theme.css';

import ElementPlus from 'element-plus';
import { createPinia } from 'pinia';
import { createApp } from 'vue';

import App from './App.vue';
import router from './router';
import { installCsrfHook } from './stores/auth';

const app = createApp(App);
app.use(createPinia());
installCsrfHook();
app.use(router);
app.use(ElementPlus);
app.mount('#app');
