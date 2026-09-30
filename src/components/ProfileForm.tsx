import { AVATARS } from '@/config/avatars';
import { cx } from '@/utils/format';
import { Avatar } from './Avatar';
import { cleanName, inputClass, NAME_MAX } from './fields';

/** Name field + avatar picker shared by first run, "Add profile" and "Edit profile". */
export function ProfileForm({
  name,
  avatarId,
  onName,
  onAvatar,
  onSubmit,
}: {
  name: string;
  avatarId: string;
  onName: (name: string) => void;
  onAvatar: (id: string) => void;
  onSubmit?: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 text-left">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Name
        <input
          className={inputClass}
          value={name}
          maxLength={NAME_MAX}
          placeholder="Your name"
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && cleanName(name)) onSubmit?.();
          }}
          data-autofocus
        />
      </label>
      <div>
        <div className="mb-2 text-xs text-muted">Avatar</div>
        <div className="flex gap-3" role="radiogroup" aria-label="Avatar">
          {AVATARS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={avatarId === a.id}
              aria-label={a.name}
              onClick={() => onAvatar(a.id)}
              className={cx(
                'cursor-pointer rounded-2xl p-1 ring-2 transition-[box-shadow,transform] hover:-translate-y-0.5',
                avatarId === a.id ? 'ring-accent-soft' : 'ring-transparent',
              )}
            >
              <Avatar id={a.id} size={52} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
