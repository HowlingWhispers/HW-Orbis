import type { OrbisUser } from '../auth/AuthContext';

export function UserAvatar({ user, size = 38 }: { user: OrbisUser; size?: number }) {
  const fallback = user.displayName.slice(0, 1).toLocaleUpperCase();
  return (
    <span className="user-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {user.avatarUrl ? <img className="user-avatar__image" src={user.avatarUrl} alt="" /> : <span>{fallback}</span>}
      {user.avatarDecorationUrl && <img className="user-avatar__decoration" src={user.avatarDecorationUrl} alt="" />}
    </span>
  );
}
