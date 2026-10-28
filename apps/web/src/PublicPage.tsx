import type { ReactNode } from 'react';
import { ArrowUpRight, Check, LogIn, PencilLine } from 'lucide-react';
import { PublicIntro } from './PublicIntro';
import { InstallControls } from './InstallControls';

export function PublicPage({ children, blocked = false, onLogin, onStart, starting = false, startError = '' }: { children: ReactNode; blocked?: boolean; onLogin?: () => void; onStart?: () => void; starting?: boolean; startError?: string }) {
  return <div className="public-page" inert={blocked}>
    <header className="landing-nav">
      <a className="landing-brand" href="/" aria-label="BluviBoard — главная"><img src="/favicon.svg" alt="" width="34" height="34" /><span>BluviBoard<span className="brand-period">.</span></span></a>
      <nav aria-label="Главная навигация"><a href="#possibilities">Возможности</a><a href="/dlya-ucheby/">Для учёбы</a><a className="landing-nav-login" href="#start" onClick={onLogin ? (event) => { event.preventDefault(); onLogin(); } : undefined}><LogIn size={16} />Войти в аккаунт <ArrowUpRight size={15} /></a></nav>
    </header>
    <main className="landing-main">
      <PublicIntro onStart={onStart} starting={starting} startError={startError} />
      <section className="landing-start" aria-label="Начать работу">
        <div className="landing-start-copy"><span className="landing-kicker"><PencilLine size={15} /> ПРОСТО НАЧНИТЕ</span><h2>Ваша следующая идея<br />уже где-то рядом<span>.</span></h2><p>Дайте ей немного пространства. Откройте чистый холст, сделайте первый набросок — остальное придёт по ходу.</p>
          <ul><li><Check size={16} />Можно начать без регистрации</li><li><Check size={16} />Гостевые доски перейдут в ваш аккаунт</li><li><Check size={16} />Работает в браузере и приложении для Windows</li></ul>
          <span className="landing-handwritten">Не обязательно уметь рисовать <span>↗</span></span>
        </div>
        {children}
      </section>
    </main>
    <footer className="landing-footer"><div><a className="landing-brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28" /><span>BluviBoard<span className="brand-period">.</span></span></a><p>Немного пространства для больших идей.</p></div><InstallControls /><small>Сделано, чтобы мысли не терялись.</small></footer>
  </div>;
}
