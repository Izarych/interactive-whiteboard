import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DatabaseService } from './database.service';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { StorageService } from './storage.service';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { MailService } from './auth/mail.service';
import { AdminGuard } from './admin/admin.guard';
import { AdminService } from './admin/admin.service';
import { AdminController } from './admin/admin.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController, BoardsController, AssetsController, AuthController, AdminController],
  providers: [DatabaseService, BoardsService, StorageService, AssetsService, AuthService, AuthGuard, MailService, AdminGuard, AdminService],
})
export class AppModule {}
