export interface DrawnElement {
  id: string;
  /** Fragments of an erased contour can still be deleted as one object. */
  groupId?: string;
  kind: 'stroke' | 'rectangle' | 'ellipse';
  color: string;
  width: number;
  /** World coordinates. Shapes use [startX, startY, endX, endY]. */
  points: number[];
}

export interface ImageElement {
  id: string;
  kind: 'image';
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DrawingElement = DrawnElement | ImageElement;

export interface ImageAsset {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface DesktopRelease {
  version: string;
  downloadUrl: string;
  releaseUrl: string;
}

export interface BoardBackground {
  pattern: 'plain' | 'dots' | 'grid';
  /** Integer cell spacing from 12 to 96 in world coordinates, independent of camera zoom. */
  size: number;
}

export interface BoardDocument {
  version: 1;
  elements: DrawingElement[];
  /** Older documents default to a 24-unit dotted background. */
  background?: BoardBackground;
}

export interface BoardSummary {
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface Board extends BoardSummary {
  document: BoardDocument;
}

export interface UpdateBoard {
  title: string;
  document: BoardDocument;
  revision: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: 'user' | 'admin';
}

export interface AdminPage<T> { items: T[]; total: number; page: number; pageSize: number }
export interface AdminUser extends UserProfile {
  workspaceId: string; blockedAt: string | null; createdAt: string; lastSeenAt: string | null;
  boards: number; assets: number; sessions: number;
}
export interface AdminGuest {
  id: string; createdAt: string; blockedAt: string | null; lastSeenAt: string | null;
  boards: number; assets: number; sessions: number;
}
export interface AdminBoard extends BoardSummary {
  ownerId: string | null; ownerName: string | null; ownerEmail: string | null; elements: number; images: number;
}
export interface AdminAsset extends ImageAsset {
  ownerId: string | null; ownerName: string | null; ownerEmail: string | null;
  provider: 'local' | 's3'; purpose: 'board' | 'avatar'; size: number; createdAt: string;
}
export interface AdminAudit { id: string; action: string; actorName: string | null; targetId: string | null; details: Record<string, unknown>; createdAt: string }
export interface AdminOverview {
  users: number; guests: number; boards: number; images: number; bytes: number;
  sessions: number; blockedUsers: number; activeWorkspaces: number; pendingRegistrations: number;
  trend: { day: string; users: number; guests: number; boards: number }[];
  recentUsers: AdminUser[]; recentBoards: AdminBoard[];
}

export type ActiveSession =
  | { kind: 'guest'; workspaceId: string; user: null }
  | { kind: 'user'; workspaceId: string; user: UserProfile };

export type SessionInfo = ActiveSession | { kind: 'anonymous'; workspaceId: null; user: null };

export interface EmailChallenge {
  challengeId: string;
  email: string;
  expiresAt: string;
  retryAfterSeconds: number;
}

export interface RegisterAccount {
  email: string;
  password: string;
  name: string;
  avatarAssetId?: string;
}
