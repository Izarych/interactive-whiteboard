import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { AdminCreateUserDto, AdminNameDto, AdminPasswordDto, AdminQueryDto, AdminRoleDto, AdminUpdateUserDto, BlockDto, OverviewQueryDto, TransferGuestDto } from './admin.dto';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { EmailDto } from '../auth/auth.dto';
import { MailService } from '../auth/mail.service';
import { MAX_IMAGE_BYTES } from '../assets.service';
import { SiteFilesService } from '../site-files.service';
import { UpdateSiteFileDto } from '../site-files.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService, private readonly mail: MailService, private readonly files: SiteFilesService) {}
  @Get('site-files') siteFiles() { return this.files.list(); }
  @Put('site-files/:name') updateSiteFile(@Req() request: AuthenticatedRequest, @Param('name') name: string, @Body() dto: UpdateSiteFileDto) { return this.admin.updateSiteFile(request.auth, name, dto); }
  @Get('overview') overview(@Query() query: OverviewQueryDto) { return this.admin.overview(query.days); }
  @Get('users') users(@Query() query: AdminQueryDto) { return this.admin.users(query); }
  @Post('users') create(@Req() request: AuthenticatedRequest, @Body() dto: AdminCreateUserDto) { return this.admin.createUser(request.auth, dto); }
  @Patch('users/:id') @HttpCode(204) updateUser(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUpdateUserDto) { return this.admin.updateUser(request.auth, id, dto); }
  @Post('users/:id/avatar')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0 } }))
  avatar(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) { return this.admin.avatar(request.auth, id, file); }
  @Post('users/:id/password') @HttpCode(204)
  password(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminPasswordDto) { return this.admin.password(request.auth, id, dto.password); }
  @Post('users/:id/role') @HttpCode(204)
  role(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminRoleDto) { return this.admin.role(request.auth, id, dto.role, dto.password); }
  @Post('users/:id/block') @HttpCode(204)
  blockUser(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockDto) { return this.admin.block(request.auth, 'users', id, dto.blocked); }
  @Post('users/:id/revoke-sessions') @HttpCode(204)
  revoke(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.admin.revokeSessions(request.auth, id); }
  @Delete('users/:id') @HttpCode(204)
  deleteUser(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteOwner(request.auth, 'users', id); }
  @Get('guests') guests(@Query() query: AdminQueryDto) { return this.admin.guests(query); }
  @Post('guests/:id/block') @HttpCode(204)
  blockGuest(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockDto) { return this.admin.block(request.auth, 'guests', id, dto.blocked); }
  @Post('guests/:id/transfer') @HttpCode(204)
  transfer(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferGuestDto) { return this.admin.transferGuest(request.auth, id, dto.email); }
  @Delete('guests/:id') @HttpCode(204)
  deleteGuest(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteOwner(request.auth, 'guests', id); }
  @Get('boards') boards(@Query() query: AdminQueryDto) { return this.admin.boards(query); }
  @Get('boards/:id') board(@Param('id', ParseUUIDPipe) id: string) { return this.admin.board(id); }
  @Patch('boards/:id') @HttpCode(204) updateBoard(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminNameDto) { return this.admin.updateBoard(request.auth, id, dto.title); }
  @Post('boards/:id/clear') @HttpCode(204)
  clear(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.admin.clearBoard(request.auth, id); }
  @Delete('boards/:id') @HttpCode(204)
  deleteBoard(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteBoard(request.auth, id); }
  @Get('images') images(@Query() query: AdminQueryDto) { return this.admin.images(query); }
  @Delete('images/:id') @HttpCode(204)
  deleteImage(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteImage(request.auth, id); }
  @Get('audit') audit(@Query() query: AdminQueryDto) { return this.admin.auditLog(query); }
  @Post('mail/preview') @HttpCode(204)
  preview(@Body() dto: EmailDto) { return this.mail.sendPreview(dto.email); }
}
