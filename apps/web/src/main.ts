// eslint-disable-next-line import/no-unresolved
import 'element-plus/dist/index.css';
import './styles/theme.css';
import './styles/transitions.css';
import './styles/print.css';

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

// Wait until the initial route is fully resolved (incl. all beforeEach guards)
// before mounting. Otherwise AppShell renders with `route.meta` unset, briefly
// flashing the sidebar layout on /login etc.
void router.isReady().then(() => {
  app.mount('#app');
});
