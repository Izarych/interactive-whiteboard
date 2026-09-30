const retry = document.getElementById('retry');
const status = document.getElementById('status');
let opening = false;

async function connect() {
  if (opening) return;
  opening = true;
  retry.disabled = true;
  status.textContent = 'Открываем ваше пространство…';
  try {
    // A public, credential-free check keeps the launcher usable on a first offline start.
    await fetch('https://bluviboard.ru/', {
      mode: 'no-cors', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    window.location.replace('https://bluviboard.ru/');
  } catch {
    status.textContent = 'Не удалось подключиться к BluviBoard. Проверьте интернет и попробуйте снова.';
    retry.hidden = false;
    retry.disabled = false;
    opening = false;
  }
}

retry.addEventListener('click', connect);
window.addEventListener('online', connect);
void connect();
