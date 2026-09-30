import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';

@Injectable()
export class AdminGuard extends AuthGuard {
  async canActivate(context: ExecutionContext) {
    await super.canActivate(context);
    if (context.switchToHttp().getRequest<AuthenticatedRequest>().auth.role !== 'admin') throw new ForbiddenException('Доступ разрешён только администратору');
    return true;
  }
}
