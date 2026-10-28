import { InstallControls } from './InstallControls';

export function PublicIntro() {
  return <aside className="public-intro" itemScope itemType="https://schema.org/WebApplication">
    <meta itemProp="name" content="BluviBoard" />
    <meta itemProp="applicationCategory" content="ProductivityApplication" />
    <meta itemProp="operatingSystem" content="Web" />
    <link itemProp="url" href="https://bluviboard.ru/" />
    <div className="public-brand"><img src="/favicon.svg" alt="" /><span>BluviBoard</span></div>
    <span className="public-eyebrow">ПРОСТРАНСТВО ДЛЯ ВАШИХ ИДЕЙ</span>
    <h1>Онлайн-доска<br /> для учёбы и рисования</h1>
    <p itemProp="description">Решайте задачи, рисуйте схемы и ведите конспекты от руки на интерактивной онлайн-доске BluviBoard. Добавляйте скриншоты, выбирайте фон в клетку и сохраняйте результат в PNG.</p>
    <a className="public-start-link" href="#start">Открыть доску</a>
    <ul>
      <li><span>✎</span><div><strong>Пишите и объясняйте</strong><small>Карандаш, маркер, фигуры и изображения</small></div></li>
      <li><span>▦</span><div><strong>Решайте задачи в клетку</strong><small>Клетка и точки с настройкой размера</small></div></li>
      <li><span>✓</span><div><strong>Сохраняйте свои идеи</strong><small>Несколько досок и автосохранение</small></div></li>
    </ul>
    <p className="public-guest-note">Начните как гость — доски перейдут в ваш аккаунт при регистрации.</p>
    <nav className="public-guides" aria-label="Как использовать BluviBoard">
      <a href="/dlya-ucheby/"><strong>Доска для учёбы</strong><span>Задачи, схемы и конспекты — с чего начать →</span></a>
      <a href="/doska-v-kletku/"><strong>Онлайн-доска в клетку</strong><span>Как настроить фон для математики и рисунков →</span></a>
    </nav>
    <InstallControls />
  </aside>;
}
