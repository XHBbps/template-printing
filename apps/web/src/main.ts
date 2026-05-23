// eslint-disable-next-line import/no-unresolved
import 'element-plus/dist/index.css';
import './styles/theme.css';
import './styles/transitions.css';

// eslint-disable-next-line import/no-unresolved
import ElementPlus from 'element-plus';
// eslint-disable-next-line import/no-unresolved
import { createPinia } from 'pinia';
// eslint-disable-next-line import/no-unresolved
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
