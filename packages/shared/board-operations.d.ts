import type { Board, BoardOperation } from './index';
export function equal(a: unknown, b: unknown): boolean;
export function difference(before: Board, after: Board): BoardOperation;
export function applyOperation(board: Board, operation: BoardOperation): Board;
