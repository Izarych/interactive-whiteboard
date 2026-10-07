import { useCallback, useEffect, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ArrowLeft, Ban, Check, ChevronLeft, ChevronRight, CircleUserRound, Eye, FileImage, FileText, Ghost, LayoutDashboard, LogOut, Mail, PanelsTopLeft, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import type { AdminAsset, AdminAudit, AdminBoard, AdminGuest, AdminOverview, AdminPage, AdminUser, Board, UserProfile } from '@whiteboard/shared';
import type Konva from 'konva';
import { adminApi } from './adminApi';
import { errorMessage } from './api';
import { AvatarPicker } from './AvatarPicker';
import { Canvas } from './Canvas';
import { DEFAULT_BACKGROUND } from './background';
import { SiteFilesEditor } from './SiteFilesEditor';
import './admin.css';

const sections = [
  { id: 'overview', label: 'Обзор', icon: LayoutDashboard }, { id: 'users', label: 'Пользователи', icon: Users },
  { id: 'guests', label: 'Гости', icon: Ghost }, { id: 'boards', label: 'Доски', icon: PanelsTopLeft },
  { id: 'images', label: 'Изображения', icon: FileImage }, { id: 'audit', label: 'Журнал действий', icon: ShieldCheck },
  { id: 'mail', label: 'Почта', icon: Mail },
  { id: 'site-files', label: 'Файлы сайта', icon: FileText },
] as const;
type Section = typeof sections[number]['id'];
type Entry = AdminUser | AdminGuest | AdminBoard | AdminAsset | AdminAudit;
type Modal = { kind: 'user'; user?: AdminUser } | { kind: 'board'; board: Board & AdminBoard } | { kind: 'transfer'; guest: AdminGuest } | null;
const dates = (value?: string | null) => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const bytes = (value: number) => value < 1048576 ? `${(value / 1024).toFixed(1)} КБ` : value < 1073741824 ? `${(value / 1048576).toFixed(1)} МБ` : `${(value / 1073741824).toFixed(2)} ГБ`;
const owner = (item: { ownerName: string | null; ownerId: string | null }) => item.ownerName ?? (item.ownerId ? `Гость ${item.ownerId.slice(0, 8)}` : 'Без владельца');
const routeSection = (): Section => sections.find((item) => item.id === window.location.pathname.split('/')[2])?.id ?? 'overview';
const actions: Record<string, string> = { admin_created_cli: 'Создан администратор (CLI)', user_created: 'Создан пользователь', user_updated: 'Обновлён профиль', avatar_changed: 'Изменён аватар', password_changed: 'Изменён пароль', users_blocked: 'Пользователь заблокирован', users_unblocked: 'Пользователь разблокирован', users_deleted: 'Удалён пользователь', guests_blocked: 'Гость заблокирован', guests_unblocked: 'Гость разблокирован', guests_deleted: 'Удалён гость', guest_transferred: 'Доски гостя переданы аккаунту', sessions_revoked: 'Завершены сессии', board_renamed: 'Доска переименована', board_cleared: 'Холст очищен', board_deleted: 'Доска удалена', image_deleted: 'Изображение удалено' };

actions.role_changed = 'Изменена роль пользователя';
actions.site_file_updated = 'Обновлён файл сайта';

export default function AdminPanel({ user, blocked, onBack, onProfile, onLogout }: {
  user: UserProfile; blocked: boolean; onBack: () => void; onProfile: () => void; onLogout: () => Promise<void>;
}) {
  const [section, setSection] = useState<Section>(routeSection);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [data, setData] = useState<AdminPage<Entry> | null>(null);
  const [days, setDays] = useState(30);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<Modal>(null);
  const [email, setEmail] = useState(user.email);
  const generation = useRef(0);

  useEffect(() => {
    const pop = () => { setSection(routeSection()); setPage(1); setSearch(''); };
    window.addEventListener('popstate', pop);
    return () => { window.removeEventListener('popstate', pop); };
  }, []);
  const load = useCallback(async () => {
    const version = ++generation.current;
    setLoading(true); setError('');
    try {
      if (section === 'overview') { const result = await adminApi.overview(days); if (version === generation.current) setOverview(result); }
      else if (section !== 'mail' && section !== 'site-files') {
        const result = section === 'users' ? await adminApi.users(page, search, status) : section === 'guests' ? await adminApi.guests(page, search, status)
          : section === 'boards' ? await adminApi.boards(page, search) : section === 'images' ? await adminApi.images(page, search) : await adminApi.audit(page, search);
        if (version === generation.current) setData(result);
      }
    } catch (reason) { if (version === generation.current) setError(errorMessage(reason)); }
    finally { if (version === generation.current) setLoading(false); }
  }, [section, page, search, status, days]);
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 180); return () => { clearTimeout(timer); generation.current++; }; }, [load]);
  const navigate = (next: Section) => {
    setSection(next); setPage(1); setSearch(''); setStatus('all'); setNotice(''); setData(null);
    window.history.pushState(null, '', next === 'overview' ? '/admin' : `/admin/${next}`);
  };
  const run = async (operation: () => Promise<unknown>, message = 'Изменения сохранены') => {
    if (working) return;
    setWorking(true); setError(''); setNotice('');
    try { await operation(); setNotice(message); await load(); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setWorking(false); }
  };
  const openBoard = (id: string) => run(async () => { setModal({ kind: 'board', board: await adminApi.board(id) }); }, '');
  const confirm = (question: string, operation: () => Promise<unknown>, message: string) => { if (window.confirm(question)) void run(operation, message); };
  const label = sections.find((item) => item.id === section)!.label;
  const button = (title: string, icon: React.ReactNode, action: () => void, danger = false, disabled = false) => <button type="button" aria-label={title} title={title} className={`admin-icon-button ${danger ? 'danger' : ''}`} disabled={working || disabled} onClick={action}>{icon}</button>;
  const renderRow = (entry: Entry) => {
    if (section === 'users') {
      const item = entry as AdminUser;
      return <tr key={item.id}><td><div className="admin-person"><span className="admin-avatar">{item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : Array.from(item.name)[0]}</span><div><strong>{item.name}</strong><small>{item.email}</small></div></div></td>
        <td><span className={`admin-badge ${item.role === 'admin' ? 'purple' : ''}`}>{item.role === 'admin' ? 'Администратор' : 'Пользователь'}</span></td>
        <td><span className={`admin-badge ${item.blockedAt ? 'red' : 'green'}`}>{item.blockedAt ? 'Заблокирован' : 'Активен'}</span></td><td>{item.boards}</td><td>{item.sessions}</td><td>{dates(item.lastSeenAt)}</td>
        <td><div className="admin-actions">{button(`Изменить ${item.name}`, <Pencil size={15} />, () => setModal({ kind: 'user', user: item }))}
          {button(`${item.blockedAt ? 'Разблокировать' : 'Заблокировать'} ${item.name}`, item.blockedAt ? <Check size={15} /> : <Ban size={15} />, () => { void run(() => adminApi.block('users', item.id, !item.blockedAt)); }, false, item.id === user.id)}
          {button(`Завершить сессии ${item.name}`, <LogOut size={15} />, () => confirm('Завершить все сессии пользователя?', () => adminApi.revoke(item.id), 'Сессии завершены'))}
          {button(`Удалить ${item.name}`, <Trash2 size={15} />, () => confirm(`Удалить пользователя «${item.name}», его доски и файлы?`, () => adminApi.deleteOwner('users', item.id), 'Пользователь удалён'), true, item.id === user.id)}</div></td></tr>;
    }
    if (section === 'guests') {
      const item = entry as AdminGuest;
      return <tr key={item.id}><td><div className="admin-person"><span className="admin-avatar guest"><Ghost size={18} /></span><div><strong>Гость {item.id.slice(0, 8)}</strong><small>{item.id}</small></div></div></td>
        <td><span className={`admin-badge ${item.blockedAt ? 'red' : 'green'}`}>{item.blockedAt ? 'Заблокирован' : 'Активен'}</span></td><td>{item.boards}</td><td>{item.assets}</td><td>{dates(item.lastSeenAt)}</td>
        <td><div className="admin-actions">{button('Передать доски аккаунту', <Users size={15} />, () => setModal({ kind: 'transfer', guest: item }))}
          {button(item.blockedAt ? 'Разблокировать гостя' : 'Заблокировать гостя', <Ban size={15} />, () => { void run(() => adminApi.block('guests', item.id, !item.blockedAt)); })}
          {button('Удалить гостя', <Trash2 size={15} />, () => confirm('Удалить гостевое пространство вместе с досками и файлами?', () => adminApi.deleteOwner('guests', item.id), 'Гостевое пространство удалено'), true)}</div></td></tr>;
    }
    if (section === 'boards') {
      const item = entry as AdminBoard;
      return <tr key={item.id}><td><div className="admin-person"><span className="admin-avatar board"><PanelsTopLeft size={17} /></span><div><strong>{item.title}</strong><small>{item.id.slice(0, 18)}…</small></div></div></td><td><strong>{owner(item)}</strong><small className="admin-cell-small">{item.ownerEmail}</small></td><td>{item.elements}</td><td>{item.images}</td><td>{dates(item.updatedAt)}</td>
        <td><div className="admin-actions">{button(`Открыть ${item.title}`, <Eye size={16} />, () => { void openBoard(item.id); })}
          {button(`Очистить ${item.title}`, <Ban size={15} />, () => confirm(`Очистить рисунок на доске «${item.title}»?`, () => adminApi.clearBoard(item.id), 'Холст очищен'))}
          {button(`Удалить ${item.title}`, <Trash2 size={15} />, () => confirm(`Удалить доску «${item.title}»?`, () => adminApi.deleteBoard(item.id), 'Доска удалена'), true)}</div></td></tr>;
    }
    if (section === 'images') {
      const item = entry as AdminAsset;
      return <tr key={item.id}><td><div className="admin-person"><img className="admin-image-thumb" src={item.url} alt="Изображение" loading="lazy" /><div><strong>{item.purpose === 'avatar' ? 'Аватар' : 'Изображение доски'}</strong><small>{item.id.slice(0, 18)}…</small></div></div></td><td>{owner(item)}</td><td>{item.width} × {item.height}</td><td>{bytes(item.size)}</td><td><span className="admin-badge">{item.provider === 's3' ? 'Object Storage' : 'Локально'}</span></td>
        <td><div className="admin-actions"><a className="admin-icon-button" aria-label="Открыть изображение" href={item.url} target="_blank" rel="noreferrer"><Eye size={16} /></a>
          {button('Удалить изображение', <Trash2 size={15} />, () => confirm('Удалить файл? Используемое изображение сначала нужно убрать с доски или из профиля.', () => adminApi.deleteImage(item.id), 'Файл удалён'), true)}</div></td></tr>;
    }
    const item = entry as AdminAudit;
    return <tr key={item.id}><td><strong>{actions[item.action] ?? item.action}</strong></td><td>{item.actorName ?? 'Серверная команда'}</td><td><code>{item.targetId?.slice(0, 18) ?? '—'}</code></td><td>{dates(item.createdAt)}<small className="admin-cell-small">{new Date(item.createdAt).toLocaleTimeString('ru-RU')}</small></td><td><code>{JSON.stringify(item.details)}</code></td></tr>;
  };
  const headers = section === 'users' ? ['Пользователь', 'Роль', 'Статус', 'Доски', 'Сессии', 'Активность', 'Действия'] : section === 'guests' ? ['Гость', 'Статус', 'Доски', 'Файлы', 'Активность', 'Действия']
    : section === 'boards' ? ['Доска', 'Владелец', 'Объекты', 'Картинки', 'Обновлена', 'Действия'] : section === 'images' ? ['Файл', 'Владелец', 'Размеры', 'Объём', 'Хранилище', 'Действия'] : ['Действие', 'Администратор', 'Объект', 'Дата', 'Подробности'];

  return <div className="admin-root" inert={blocked}>
    <div className="admin-layout" inert={!!modal}>
      <aside className="admin-sidebar"><div className="admin-brand"><img src="/favicon.svg" alt="" /><div>BluviBoard<small>Панель управления</small></div></div>
        <div className="admin-nav-label">УПРАВЛЕНИЕ</div><nav aria-label="Разделы админ-панели">{sections.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={18} />{item.label}</button>)}</nav>
        <div className="admin-sidebar-bottom"><button onClick={onBack}><ArrowLeft size={17} />Вернуться к доскам</button><button onClick={() => { void run(onLogout, ''); }}><LogOut size={17} />Выйти</button></div>
        <div className="admin-sidebar-user"><span className="admin-avatar">{user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : Array.from(user.name)[0]}</span><div><strong>{user.name}</strong><small>Администратор</small></div></div>
      </aside>
      <div className="admin-workspace"><header className="admin-header"><div><span>BluviBoard / Управление</span><h1>{label}</h1></div><div className="admin-header-actions"><span className="admin-access-badge"><ShieldCheck size={14} />Администратор</span><button className="admin-icon-button" aria-label="Открыть профиль" onClick={onProfile}><CircleUserRound size={20} /></button></div></header>
        <main className="admin-content">
          {error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="form-notice" role="status">{notice}</div>}
          {section === 'overview' ? <>
            <div className="admin-section-heading"><div><h2>Всё пространство в одном месте</h2><p>Пользователи, активность и идеи, которые они создают.</p></div><button className="admin-secondary" disabled={loading} onClick={() => { void load(); }}><RefreshCw size={14} />Обновить</button></div>
            {overview && <>
              <div className="admin-stat-grid">{[
                { title: 'Пользователи', value: overview.users, note: 'Подтверждённые аккаунты', icon: Users, color: 'blue' },
                { title: 'Гости', value: overview.guests, note: 'Гостевые пространства', icon: Ghost, color: 'purple' },
                { title: 'Доски', value: overview.boards, note: 'Сохранённые пространства идей', icon: PanelsTopLeft, color: 'green' },
                { title: 'Хранилище', value: bytes(overview.bytes), note: `Изображения и аватары: ${overview.images}`, icon: FileImage, color: 'orange' },
              ].map((card) => <article key={card.title} className="admin-stat"><div><span>{card.title}</span><div className={`admin-stat-icon ${card.color}`}><card.icon size={19} /></div></div><strong>{card.value}</strong><small>{card.note}</small></article>)}</div>
              <div className="admin-chart-row"><section className="admin-card admin-chart-card"><div className="admin-card-heading"><div><h3>Как растёт BluviBoard</h3><p>Новые пользователи, гости и доски</p></div><select aria-label="Период аналитики" value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option></select></div>
                <div className="admin-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={overview.trend} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="usersFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} /><stop offset="100%" stopColor="#6366f1" stopOpacity={0} /></linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#edf0f6" /><XAxis dataKey="day" tickFormatter={(day) => new Date(day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} tick={{ fontSize: 10, fill: '#9298a6' }} axisLine={false} tickLine={false} minTickGap={32} /><YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#9298a6' }} axisLine={false} tickLine={false} />
                  <Tooltip labelFormatter={(day) => dates(String(day))} contentStyle={{ borderRadius: 12, border: '1px solid #e5e7ee', fontSize: 12 }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 12 }} />
                  <Area type="monotone" dataKey="users" name="Пользователи" stroke="#6366f1" fill="url(#usersFill)" strokeWidth={2} isAnimationActive={false} /><Area type="monotone" dataKey="guests" name="Гости" stroke="#a78bfa" fill="transparent" strokeWidth={2} isAnimationActive={false} /><Area type="monotone" dataKey="boards" name="Доски" stroke="#34b7a0" fill="transparent" strokeWidth={2} isAnimationActive={false} />
                </AreaChart></ResponsiveContainer></div></section>
                <section className="admin-card admin-health-card"><div className="admin-card-heading"><div><h3>Активность и доступ</h3><p>Текущее состояние пространства</p></div><ShieldCheck size={20} /></div>
                  {[['Действующие сессии', overview.sessions], ['Активны за 7 дней', overview.activeWorkspaces], ['Ожидают подтверждения', overview.pendingRegistrations], ['Заблокированные аккаунты', overview.blockedUsers]].map(([name, count]) => <div className="admin-health-item" key={name}><span>{name}</span><strong>{count}</strong></div>)}
                  <div className="admin-health-note"><Check size={16} />Доступ к данным защищён ролями</div></section></div>
              <div className="admin-recent-grid"><section className="admin-card"><div className="admin-card-heading"><h3>Новые пользователи</h3><button onClick={() => navigate('users')}>Все пользователи →</button></div>{overview.recentUsers.map((item) => <div className="admin-recent-item" key={item.id}><span className="admin-avatar">{Array.from(item.name)[0]}</span><div><strong>{item.name}</strong><small>{item.email}</small></div><span>{dates(item.createdAt)}</span></div>)}</section>
                <section className="admin-card"><div className="admin-card-heading"><h3>Последние доски</h3><button onClick={() => navigate('boards')}>Все доски →</button></div>{overview.recentBoards.map((item) => <button className="admin-recent-item admin-recent-board" key={item.id} onClick={() => { void openBoard(item.id); }}><span className="admin-avatar board"><PanelsTopLeft size={16} /></span><div><strong>{item.title}</strong><small>{owner(item)}</small></div><span>{item.elements} объектов</span></button>)}{!overview.recentBoards.length && <p className="admin-empty">Доски появятся здесь после создания</p>}</section></div>
            </>}{loading && !overview && <p className="admin-empty">Загружаем аналитику…</p>}
          </> : section === 'mail' ? <section className="admin-card admin-mail-card"><div className="admin-mail-icon"><Mail size={30} /></div><h2>Письма, которые приятно открыть</h2><p>Проверьте фирменное письмо BluviBoard перед отправкой пользователям.</p><form onSubmit={(event) => { event.preventDefault(); void run(() => adminApi.previewMail(email), 'Тестовое письмо отправлено'); }}><label className="form-label">Почта получателя<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><button className="primary-button" disabled={working}>Отправить тестовое письмо</button></form><small>Письмо-пример не создаёт аккаунт и не меняет пароль.</small></section>
            : section === 'site-files' ? <SiteFilesEditor /> : <section className="admin-card admin-table-card"><div className="admin-table-toolbar"><div className="admin-search"><Search size={16} /><input aria-label="Поиск в админ-панели" placeholder={section === 'users' ? 'Имя или почта…' : section === 'guests' ? 'ID гостя…' : 'Поиск…'} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></div>
              {['users', 'guests'].includes(section) && <select aria-label="Статус записей" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">Все статусы</option><option value="active">Активные</option><option value="blocked">Заблокированные</option></select>}
              <button className="admin-icon-button" aria-label="Обновить список" onClick={() => { void load(); }}><RefreshCw size={16} /></button>
              {section === 'users' && <button className="primary-button admin-create-user" onClick={() => setModal({ kind: 'user' })}><Plus size={15} />Новый пользователь</button>}</div>
              <div className="admin-table-scroll"><table className="admin-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{data?.items.map(renderRow)}</tbody></table>
                {!data?.items.length && <p className="admin-empty">{loading ? 'Загрузка…' : 'Записей не найдено'}</p>}</div>
              <div className="admin-pagination"><span>Всего: {data?.total ?? 0}{loading ? ' · обновление…' : ''}</span><div><button aria-label="Предыдущая страница" disabled={page === 1 || loading} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button><span>{page} / {Math.max(1, Math.ceil((data?.total ?? 0) / 20))}</span><button aria-label="Следующая страница" disabled={page * 20 >= (data?.total ?? 0) || loading} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></div></div>
            </section>}
        </main></div>
    </div>
    {modal && <AdminModal modal={modal} onClose={() => setModal(null)} onSaved={async () => { setModal(null); setNotice('Изменения сохранены'); await load(); }} />}
  </div>;
}

function AdminModal({ modal, onClose, onSaved }: { modal: NonNullable<Modal>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(modal.kind === 'user' ? modal.user?.name ?? '' : modal.kind === 'board' ? modal.board.title : '');
  const [email, setEmail] = useState(modal.kind === 'user' ? modal.user?.email ?? '' : '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>(modal.kind === 'user' ? modal.user?.role ?? 'user' : 'user');
  const [administratorPassword, setAdministratorPassword] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const stage = useRef<Konva.Stage | null>(null);
  const save = async () => {
    setBusy(true); setError('');
    try {
      if (modal.kind === 'board') await adminApi.renameBoard(modal.board.id, name);
      else if (modal.kind === 'transfer') await adminApi.transferGuest(modal.guest.id, email);
      else if (!modal.user) await adminApi.createUser(name, email, password);
      else {
        await adminApi.updateUser(modal.user.id, name, removed);
        if (avatar) await adminApi.avatar(modal.user.id, avatar);
        if (password) await adminApi.password(modal.user.id, password);
        if (role !== modal.user.role) await adminApi.role(modal.user.id, role, administratorPassword);
      }
      await onSaved();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  }, [busy, onClose]);
  return <div className="auth-shell auth-shell--modal"><section className={`auth-card admin-modal ${modal.kind === 'board' ? 'admin-board-modal' : ''}`} role="dialog" aria-modal="true" aria-label={modal.kind === 'board' ? 'Просмотр доски' : modal.kind === 'transfer' ? 'Передача гостевых досок' : 'Управление пользователем'}>
    <button className="modal-close" aria-label="Закрыть окно" disabled={busy} onClick={onClose}><X size={20} /></button>
    <h1>{modal.kind === 'board' ? 'Просмотр доски' : modal.kind === 'transfer' ? 'Передать гостевые доски' : modal.user ? 'Профиль пользователя' : 'Новый пользователь'}</h1>
    {error && <div className="form-error" role="alert">{error}</div>}
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}><fieldset disabled={busy}>
      {modal.kind !== 'transfer' && <label className="form-label">{modal.kind === 'board' ? 'Название доски' : 'Имя'}<input maxLength={modal.kind === 'board' ? 120 : 80} required value={name} onChange={(event) => setName(event.target.value)} /></label>}
      {modal.kind === 'user' && modal.user && <><p className="admin-modal-email">{modal.user.email} · {modal.user.role === 'admin' ? 'Администратор' : 'Пользователь'}</p><AvatarPicker name={name} file={avatar} imageUrl={removed ? null : modal.user.avatarUrl} onChange={(file) => { setAvatar(file); setRemoved(false); }} onRemove={() => { setAvatar(null); setRemoved(true); }} onError={setError} /></>}
      {(modal.kind === 'transfer' || (modal.kind === 'user' && !modal.user)) && <label className="form-label">{modal.kind === 'transfer' ? 'Почта аккаунта-получателя' : 'Почта'}<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
      {modal.kind === 'user' && <label className="form-label">{modal.user ? 'Новый пароль (необязательно)' : 'Пароль'}<input type="password" autoComplete="new-password" required={!modal.user} minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} />{modal.user && <small>Смена пароля завершит действующие сессии.</small>}</label>}
      {modal.kind === 'user' && modal.user && <>
        <label className="form-label">Роль<select aria-label="Роль пользователя" value={role} onChange={(event) => setRole(event.target.value as 'user' | 'admin')}><option value="user">Пользователь</option><option value="admin">Администратор</option></select></label>
        {role !== modal.user.role && <label className="form-label">Ваш пароль для смены роли<input type="password" autoComplete="current-password" required maxLength={128} value={administratorPassword} onChange={(event) => setAdministratorPassword(event.target.value)} /><small>Пользователь заново войдёт в аккаунт после изменения роли.</small></label>}
      </>}
      {modal.kind === 'transfer' && <p className="auth-subtitle">Все доски и изображения гостя будут переданы указанному подтверждённому аккаунту.</p>}
      {modal.kind === 'board' && <><p className="admin-modal-email">{owner(modal.board)} · {modal.board.elements} объектов · {modal.board.images} изображений · ревизия {modal.board.revision}</p><div className="admin-board-preview"><Canvas elements={modal.board.document.elements} background={modal.board.document.background ?? DEFAULT_BACKGROUND} tool="hand" color="#202938" width={4} stageRef={stage} onChange={() => {}} selectedImageId={null} onSelectImage={() => {}} onImageFiles={() => {}} /></div></>}
      <button className="primary-button form-submit" disabled={busy}>{busy ? 'Сохранение…' : modal.kind === 'transfer' ? 'Передать доски' : 'Сохранить'}</button>
      {modal.kind === 'user' && !modal.user && <p className="admin-cli-note">Создаётся обычный пользователь. Новый административный аккаунт создаётся серверной командой; роль существующего аккаунта можно изменить в профиле.</p>}
    </fieldset></form>
  </section></div>;
}
