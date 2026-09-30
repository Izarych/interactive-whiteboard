# BluviBoard

Браузерная доска для рисунков, заметок и скриншотов. Создавайте отдельные доски для задач, работайте в гостевом режиме или сохраняйте их в аккаунте.

[Открыть приложение](https://bluviboard.ru) · [Релизы](https://github.com/Izarych/interactive-whiteboard/releases) · [Сообщить об ошибке](https://github.com/Izarych/interactive-whiteboard/issues)

![CI](https://github.com/Izarych/interactive-whiteboard/actions/workflows/deploy.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Возможности

- Карандаш, палитра, фигуры, ластик, отмена и повтор действий.
- Масштабирование, перемещение и разметка холста: точки или клетка с настройкой размера.
- Вставка скриншотов через Ctrl+V, загрузка изображений и экспорт PNG.
- Несколько досок, автосохранение и восстановление локального черновика.
- Гостевой режим с переносом досок в аккаунт, подтверждение почты, профиль и восстановление пароля.
- Административная панель для управления пользователями, гостями и досками.

## Локальная разработка

### Требования

- Node.js 24 LTS и npm 11.
- PostgreSQL 16 или совместимая версия.
- SMTP-сервер. Для разработки можно использовать MailHog на портах 1025 и 8025.

### Установка

```sh
git clone https://github.com/Izarych/interactive-whiteboard.git
cd interactive-whiteboard
npm ci
```

Скопируйте [`apps/server/.env.example`](apps/server/.env.example) в `apps/server/.env`.
Укажите `DATABASE_URL` и случайный `AUTH_SECRET` длиной не менее 32 символов:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Создайте базу данных и запустите приложения:

```sh
npm run db:setup
npm run dev
```

Клиент доступен на `http://localhost:5173`, API — на `http://localhost:3000/api`.
Vite проксирует запросы `/api` на сервер. Если база уже создана, шаг `db:setup` можно пропустить.
Таблицы и индексы создаются при запуске API.

## Структура проекта

```text
apps/
  web/       React, TypeScript, Vite и Konva
  server/    NestJS API, авторизация, почта и хранилище
packages/
  shared/    Общие типы документов и API
tests/       Интеграционные и браузерные проверки
docs/        Конфигурация и история изменений
deploy/      Скрипты развёртывания
```

Доска хранится как объектный документ: штрихи, фигуры и изображения имеют собственные идентификаторы.
Документы сохраняются в PostgreSQL; файлы — в локальном каталоге или S3-совместимом хранилище.
Ревизии документов защищают от перезаписи изменений из другой вкладки. Доступ к данным проверяется по владельцу пространства.

Параметры SMTP, хранилища и авторизации описаны в [конфигурации](docs/configuration.md).

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Запуск клиента и API |
| `npm run dev:web` | Только клиент |
| `npm run dev:server` | Только API |
| `npm run build` | Сборка всех приложений |
| `npm run test:api` | Интеграционные проверки API |
| `npm run test:e2e` | Браузерные проверки Playwright |
| `npm run admin:create -- --email admin@example.com --name "Administrator"` | Создание административного аккаунта |
| `npm run mail:preview -- --to you@example.com` | Отправка тестового письма |

## Проверки

Для интеграционных проверок нужны PostgreSQL и MailHog. Перед первым запуском браузерных тестов установите Chromium:

```sh
npm run build
npx playwright install chromium
npm run test:api
npm run test:e2e
```

Проверки аккаунтов и браузерные тесты используют временные схемы PostgreSQL. Созданные тестами данные, файлы и письма удаляются после выполнения.

## Участие в разработке

Для ошибок и предложений используйте [Issues](https://github.com/Izarych/interactive-whiteboard/issues).
В pull request опишите изменение и способ проверки. Для изменений API, авторизации или сохранения данных добавьте проверку соответствующего сценария.

## Лицензия

[MIT](LICENSE).
