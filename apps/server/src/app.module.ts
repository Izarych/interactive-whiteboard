import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { DatabaseService } from './database.service';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { StorageService } from './storage.service';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController, BoardsController, AssetsController],
  providers: [DatabaseService, BoardsService, StorageService, AssetsService],
})
export class AppModule {}
