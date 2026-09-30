import { useState } from 'react';
import { cleanName } from '@/components/fields';
import { ProfileForm } from '@/components/ProfileForm';
import { Button, Modal } from '@/components/ui';
import { AVATARS } from '@/config/avatars';
import { MAX_LEVEL } from '@/config/progression';
import { useProfiles } from '@/store/profileStore';

/** First launch: create a profile (or skip with a default one) and learn how XP works. */
export function FirstRunModal({ open }: { open: boolean }) {
  const create = useProfiles((s) => s.create);
  const [name, setName] = useState('');
  const [avatarId, setAvatarId] = useState(AVATARS[0]!.id);

  const submit = () => create(cleanName(name) || 'Player', avatarId);

  return (
    <Modal
      open={open}
      title="Welcome to Chess Arena"
      className="max-w-xl"
      actions={
        <>
          <Button variant="ghost" onClick={() => create('Player', AVATARS[0]!.id)}>
            Skip
          </Button>
          <Button variant="primary" onClick={submit} disabled={!cleanName(name)}>
            Create profile
          </Button>
        </>
      }
    >
      <p className="mb-4">Create a profile to track your level, stats and games.</p>
      <ProfileForm
        name={name}
        avatarId={avatarId}
        onName={setName}
        onAvatar={setAvatarId}
        onSubmit={submit}
      />
      <div className="mt-5 rounded-xl border border-line bg-surface p-4">
        <div className="font-display text-sm font-bold text-fg">How XP works</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
          <li>Finish games to earn XP — more for wins and for harder computer opponents.</li>
          <li>
            Bonuses for checkmate, quick wins, keeping your queen, win streaks and your first win of
            the day.
          </li>
          <li>Hints and takebacks cost 25% of a game’s XP each.</li>
          <li>Level up to {MAX_LEVEL}; you can add more profiles later for friends on this PC.</li>
        </ul>
      </div>
    </Modal>
  );
}
