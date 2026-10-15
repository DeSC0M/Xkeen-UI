export const UPDATE_CHANNEL_HINTS = Object.freeze({
  stable: 'Проверенные версии. Выбирайте, если панель просто должна работать.',
  prerelease: 'Тестовые версии с новыми функциями. Выбирайте, если готовы находить ошибки и сообщать о них.',
});

function normalizeChannel(value) {
  return value === 'prerelease' ? 'prerelease' : 'stable';
}

export function renderUpdateChannel(root, hint, value) {
  const channel = normalizeChannel(value);
  root?.querySelectorAll('[data-channel]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.channel === channel));
  });
  if (hint) {
    hint.textContent = UPDATE_CHANNEL_HINTS[channel];
    hint.dataset.channel = channel;
  }
  return channel;
}

export async function confirmPrereleaseChannel() {
  const options = {
    title: 'Перейти на предрелизный канал?',
    message: 'Панель будет обновляться до тестовых версий: новые функции появятся раньше, но возможны ошибки и недоработки.',
    details: [
      'Сейчас ничего не устанавливается — канал влияет на следующее обновление.',
      'Вернуться можно в любой момент: панель останется на установленной версии и перейдёт на стабильную, когда та выйдет новее.',
    ],
    okText: 'Перейти на предрелиз',
    cancelText: 'Остаться на стабильном',
    danger: false,
  };
  const ui = window.XKeen && window.XKeen.ui;
  if (ui && typeof ui.confirm === 'function') return !!(await ui.confirm(options));
  return window.confirm(options.message);
}

export function wireUpdateChannel({ root, hint, onSelect, onError }) {
  if (!root || typeof onSelect !== 'function') return;

  let busy = false;
  root.querySelectorAll('[data-channel]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (busy || button.getAttribute('aria-pressed') === 'true') return;
      busy = true;
      root.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      try {
        if (button.dataset.channel === 'prerelease' && !(await confirmPrereleaseChannel())) return;
        const result = await onSelect(button.dataset.channel);
        if (result && result.channel) {
          renderUpdateChannel(root, hint, result.channel);
        }
      } catch (error) {
        if (typeof onError === 'function') onError(error);
      } finally {
        busy = false;
        root.querySelectorAll('button').forEach((item) => { item.disabled = false; });
      }
    });
  });
}
