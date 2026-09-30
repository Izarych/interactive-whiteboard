import type { Request } from 'express';

export interface AuthContext {
  workspaceId: string;
  userId: string | null;
  role?: 'user' | 'admin' | null;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}
