import { PwaInstallButton } from './PwaControls';

export function PublicIntro() {
  return <aside className="public-intro" itemScope itemType="https://schema.org/WebApplication">
    <meta itemProp="name" content="BluviBoard" />
    <meta itemProp="applicationCategory" content="ProductivityApplication" />
    <meta itemProp="operatingSystem" content="Web" />
    <link itemProp="url" href="https://bluviboard.ru/" />
    <div className="public-brand"><img src="/favicon.svg" alt="" /><span>BluviBoard</span></div>
    <span className="public-eyebrow">ПРОСТРАНСТВО ДЛЯ ВАШИХ ИДЕЙ</span>
    <h1>Онлайн-доска<br />для идей и заметок</h1>
    <p itemProp="description">Рисуйте, записывайте идеи и собирайте скриншоты в одном пространстве. Создавайте несколько досок, выбирайте клетчатый фон и сохраняйте важное автоматически.</p>
    <ul>
      <li><span>✎</span><div><strong>Рисуйте без ограничений</strong><small>Карандаш, цвета, фигуры и изображения</small></div></li>
      <li><span>▦</span><div><strong>Записывайте и считайте</strong><small>Клетка и точки с настройкой размера</small></div></li>
      <li><span>✓</span><div><strong>Сохраняйте свои идеи</strong><small>Несколько досок и автосохранение</small></div></li>
    </ul>
    <p className="public-guest-note">Начните как гость — доски перейдут в ваш аккаунт при регистрации.</p>
    <PwaInstallButton />
  </aside>;
}
