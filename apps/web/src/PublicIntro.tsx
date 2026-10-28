import { ArrowDown, ArrowRight, ArrowUpRight, Check, Grid2X2, Layers3, PencilLine, Sparkles } from 'lucide-react';
import { LandingPreview } from './LandingPreview';

export function PublicIntro({ onStart, starting = false, startError = '' }: { onStart?: () => void; starting?: boolean; startError?: string }) {
  return <aside className="public-intro" itemScope itemType="https://schema.org/WebApplication">
    <meta itemProp="name" content="BluviBoard" />
    <meta itemProp="applicationCategory" content="ProductivityApplication" />
    <meta itemProp="operatingSystem" content="Web" />
    <link itemProp="url" href="https://bluviboard.ru/" />
    <div className="landing-hero">
      <div className="landing-hero-copy"><span className="landing-kicker"><span className="landing-live-dot" /> ПРОСТРАНСТВО ДЛЯ ВАШИХ ИДЕЙ</span>
        <h1>Онлайн-доска<br /> для <em>учёбы</em><br /> и рисования<span className="hero-period" aria-hidden="true" /></h1>
        <p itemProp="description">Решайте задачи, рисуйте схемы и ведите конспекты от руки на интерактивной онлайн-доске BluviBoard. Добавляйте скриншоты, выбирайте фон в клетку и сохраняйте результат в PNG.</p>
        <div className="landing-hero-actions"><a className="public-start-link" href="#start" aria-busy={starting} onClick={onStart ? (event) => { event.preventDefault(); if (!starting) onStart(); } : undefined}>Открыть доску <ArrowUpRight size={19} /></a><a className="landing-explore" href="#possibilities">А что внутри? <ArrowDown size={15} /></a></div>
        {startError && <p className="landing-start-error" role="alert">{startError}</p>}
        <p className="landing-guest-note"><Check size={14} />Без регистрации. Без лишних шагов.</p>
      </div>
      <LandingPreview />
    </div>
    <section className="landing-features" id="possibilities" aria-labelledby="possibilities-title">
      <div className="landing-section-heading"><div><span className="landing-kicker">НЕ ТОЛЬКО ЧИСТЫЙ ЛИСТ</span><h2 id="possibilities-title">Один холст.<br /><span>Столько возможностей.</span></h2></div><p>Для сложных задач, внезапных идей<br />и всего, что проще показать, чем объяснить.</p></div>
      <div className="landing-feature-grid">
        <article className="landing-feature landing-feature--draw"><div className="landing-feature-icon"><PencilLine size={24} /></div><div className="feature-doodle" aria-hidden="true"><svg viewBox="0 0 260 90"><path d="M14 57C45 3 69 86 100 41S158 26 179 46s42 21 64-17" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg><span>от мысли — к линии</span></div><h3>Думайте вслух.<br />Рисуйте от руки.</h3><p>Карандаш, полупрозрачный маркер и фигуры. Пробуйте, стирайте, начинайте заново.</p><span className="landing-feature-tag">Место для экспериментов</span></article>
        <article className="landing-feature landing-feature--grid"><div className="landing-feature-icon"><Grid2X2 size={24} /></div><div className="feature-grid-paper" aria-hidden="true"><span>a² + b² = c²</span><i /></div><h3>Сложное становится<br />понятнее.</h3><p>Клетка и точки с удобным размером. Для математики, аккуратных схем и любимых конспектов.</p><span className="landing-feature-tag">В своём ритме</span></article>
        <article className="landing-feature landing-feature--save"><div className="landing-feature-icon"><Layers3 size={24} /></div><div className="feature-paper-stack" aria-hidden="true"><i /><i /><div><span>Мои идеи</span><Check size={23} /><small>всё на своих местах</small></div></div><h3>Хорошие мысли<br />не теряются.</h3><p>Отдельная доска для каждой темы, автосохранение и экспорт рисунка в PNG.</p><span className="landing-feature-tag">Можно вернуться позже</span></article>
      </div>
    </section>
    <section className="landing-guides-section" aria-labelledby="landing-guides-title"><div className="landing-section-heading"><div><span className="landing-kicker"><Sparkles size={14} /> НЕМНОГО ВДОХНОВЕНИЯ</span><h2 id="landing-guides-title">С чего начнём?</h2></div><span className="landing-handwritten">Для ваших маленьких открытий</span></div>
      <nav className="public-guides" aria-label="Как использовать BluviBoard">
        <a href="/dlya-ucheby/"><span className="landing-guide-number">01 / УЧИТЬСЯ</span><strong>Доска для учёбы</strong><span>От условия задачи — к понятному решению. Схемы, чертежи и конспекты в одном месте.</span><span className="landing-guide-link">Найти свой подход <ArrowRight size={17} /></span><ArrowUpRight className="landing-guide-arrow" size={25} /></a>
        <a href="/doska-v-kletku/"><span className="landing-guide-number">02 / РАЗОБРАТЬСЯ</span><strong>Онлайн-доска в клетку</strong><span>Как тетрадь, только с большим простором для мысли. Подберите разметку под свою задачу.</span><span className="landing-guide-link">Попробовать по клеточкам <ArrowRight size={17} /></span><ArrowUpRight className="landing-guide-arrow" size={25} /></a>
      </nav>
    </section>
  </aside>;
}
