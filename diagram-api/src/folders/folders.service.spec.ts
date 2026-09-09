import { BadRequestException } from '@nestjs/common';
import {
  assertValidFolderMove,
  buildFolderPath,
  folderPathLabel,
} from './folders.service.js';

describe('folder paths', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';

  it('builds PostgreSQL-safe, ID-based paths', () => {
    expect(folderPathLabel(id)).toBe('f_550e8400e29b41d4a716446655440000');
    expect(buildFolderPath(id, 'f_parent')).toBe(
      'f_parent.f_550e8400e29b41d4a716446655440000',
    );
  });

  it('rejects moving under itself or a descendant', () => {
    expect(() => assertValidFolderMove('f_a', 'f_a')).toThrow(
      BadRequestException,
    );
    expect(() => assertValidFolderMove('f_a', 'f_a.f_b')).toThrow(
      BadRequestException,
    );
    expect(() => assertValidFolderMove('f_a', 'f_ab.f_b')).not.toThrow();
    expect(() => assertValidFolderMove('f_a')).not.toThrow();
  });
});
