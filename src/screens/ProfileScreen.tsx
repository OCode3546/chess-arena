import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LevelBadge, ProfileAvatar, TitleTag } from '@/components/Avatar';
import { cleanName } from '@/components/fields';
import { ProfileForm } from '@/components/ProfileForm';
import { ScreenShell } from '@/components/ScreenShell';
import { Button, Card, CardTitle, Modal } from '@/components/ui';
import { XpBar } from '@/components/XpBar';
import { ACHIEVEMENTS } from '@/config/achievements';
import { AVATARS } from '@/config/avatars';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '@/config/difficulty';
import { MAX_LEVEL } from '@/config/progression';
import { cosmeticsFor } from '@/config/rewards';
import { levelProgress } from '@/progression/levels';
import { useActiveProfile, useProfiles } from '@/store/profileStore';
import { toast } from '@/store/toastStore';
import type { Profile } from '@shared/types';
import { MAX_PROFILES } from '@shared/validate';
import { cx } from '@/utils/format';

type Editor = { mode: 'add' } | { mode: 'edit'; id: string } | null;

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-display text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function StatsCard({ profile }: { profile: Profile }) {
  const s = profile.stats;
  const rate = s.played ? `${Math.round((s.wins / s.played) * 100)}%` : '—';
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Statistics</CardTitle>
      <div className="grid grid-cols-4 gap-2">
        <Stat label="Played" value={s.played} />
        <Stat label="Wins" value={s.wins} />
        <Stat label="Draws" value={s.draws} />
        <Stat label="Losses" value={s.losses} />
        <Stat label="Win rate" value={rate} />
        <Stat label="Win streak" value={s.streak} />
        <Stat label="Best streak" value={s.bestStreak} />
        <Stat label="Fastest checkmate" value={s.fastestMate ? `${s.fastestMate} moves` : '—'} />
      </div>
      <div>
        <div className="mb-2 text-xs font-semibold text-muted">Wins vs the computer</div>
        <div className="grid grid-cols-6 gap-2">
          {DIFFICULTY_ORDER.map((d) => (
            <div key={d} className="rounded-xl border border-line bg-surface px-3 py-2 text-center">
              <div className="truncate text-[11px] text-muted">{DIFFICULTIES[d].label}</div>
              <div className="font-display text-lg font-bold tabular-nums">
                {s.winsByDifficulty[d]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function AchievementsCard({ profile }: { profile: Profile }) {
  const earned = ACHIEVEMENTS.filter((a) => a.id in profile.achievements).length;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <CardTitle>Achievements</CardTitle>
        <span className="text-xs text-muted tabular-nums">
          {earned} / {ACHIEVEMENTS.length}
        </span>
      </div>
      <ul className="grid grid-cols-5 gap-2">
        {ACHIEVEMENTS.map((a) => {
          const at = profile.achievements[a.id];
          return (
            <li
              key={a.id}
              className={cx(
                'flex flex-col items-center gap-1 rounded-xl border px-3 py-4 text-center',
                at ? 'border-warning/40 bg-warning/10' : 'border-line bg-surface opacity-55',
              )}
              data-achievement={a.id}
              data-earned={!!at || undefined}
              title={at ? `Earned ${new Date(at).toLocaleDateString()}` : 'Not earned yet'}
            >
              <span className={cx('text-3xl', !at && 'grayscale')} aria-hidden>
                {a.icon}
              </span>
              <span className="text-sm font-semibold">{a.name}</span>
              <span className="text-[11px] leading-tight text-muted">{a.description}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function ProfileScreen() {
  const navigate = useNavigate();
  const profiles = useProfiles((s) => s.profiles);
  const activeId = useProfiles((s) => s.activeId);
  const { create, update, remove, setActive } = useProfiles.getState();
  const active = useActiveProfile();

  const [editor, setEditor] = useState<Editor>(null);
  const [name, setName] = useState('');
  const [avatarId, setAvatarId] = useState(AVATARS[0]!.id);
  const [deleting, setDeleting] = useState<Profile | null>(null);

  const openAdd = () => {
    setName('');
    const starters = AVATARS.filter((a) => a.pack === 'starter');
    setAvatarId(starters[profiles.length % starters.length]!.id);
    setEditor({ mode: 'add' });
  };
  const openEdit = (p: Profile) => {
    setName(p.name);
    setAvatarId(p.avatarId);
    setEditor({ mode: 'edit', id: p.id });
  };
  const saveEditor = () => {
    const clean = cleanName(name);
    if (!clean || !editor) return;
    if (editor.mode === 'add') {
      if (create(clean, avatarId)) toast(`Profile “${clean}” created.`, 'success');
    } else {
      update(editor.id, { name: clean, avatarId });
    }
    setEditor(null);
  };

  if (!active) {
    return (
      <ScreenShell id="profile" title="Profile" subtitle="Your level, stats and profiles">
        <Card className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted">No profile yet.</p>
          <Button variant="primary" onClick={openAdd}>
            Create profile
          </Button>
        </Card>
        <ProfileEditorModal
          editor={editor}
          name={name}
          avatarId={avatarId}
          onName={setName}
          onAvatar={setAvatarId}
          onSave={saveEditor}
          onClose={() => setEditor(null)}
        />
      </ScreenShell>
    );
  }

  const progress = levelProgress(active.xp);

  return (
    <ScreenShell
      id="profile"
      title="Profile"
      subtitle="Your level, stats and profiles"
      actions={
        <Button variant="primary" onClick={() => navigate('/setup?mode=pvai')}>
          Play
        </Button>
      }
    >
      <Card className="flex items-center gap-6 p-6">
        <ProfileAvatar profile={active} size={96} className="rounded-3xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="truncate font-display text-3xl font-bold" data-profile-name>
              {active.name}
            </h2>
            <LevelBadge level={active.level} />
            <Button size="sm" variant="ghost" onClick={() => openEdit(active)}>
              Edit
            </Button>
          </div>
          <TitleTag id={cosmeticsFor(active).title} className="block text-sm" />
          <div className="mt-1 text-sm text-muted">
            {active.xp.toLocaleString()} XP total ·{' '}
            {progress.max
              ? `Maximum level ${MAX_LEVEL}`
              : `${(progress.needed - progress.into).toLocaleString()} XP to level ${progress.level + 1}`}
          </div>
          <XpBar xp={active.xp} className="mt-4" />
        </div>
      </Card>

      <StatsCard profile={active} />

      <AchievementsCard profile={active} />

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <CardTitle>Profiles on this PC</CardTitle>
          <Button
            size="sm"
            onClick={openAdd}
            disabled={profiles.length >= MAX_PROFILES}
            title={profiles.length >= MAX_PROFILES ? `Up to ${MAX_PROFILES} profiles` : undefined}
          >
            + Add profile
          </Button>
        </div>
        <ul className="flex flex-col gap-2">
          {profiles.map((p) => {
            const isActive = p.id === activeId;
            return (
              <li
                key={p.id}
                className={cx(
                  'flex items-center gap-3 rounded-xl border px-3 py-2',
                  isActive ? 'border-accent bg-accent/10' : 'border-line bg-surface',
                )}
              >
                <ProfileAvatar profile={p} size={40} className="rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold">{p.name}</span>
                    <LevelBadge level={p.level} className="h-5 px-2 text-[11px]" />
                  </div>
                  <div className="text-xs text-muted">
                    {p.stats.played} games · {p.stats.wins} wins
                  </div>
                </div>
                {isActive ? (
                  <span className="px-2 text-xs font-semibold text-accent-text">Active</span>
                ) : (
                  <Button size="sm" onClick={() => setActive(p.id)}>
                    Switch
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleting(p)}
                  disabled={profiles.length === 1}
                  title={profiles.length === 1 ? 'You need at least one profile' : undefined}
                  aria-label={`Delete ${p.name}`}
                >
                  Delete
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      <ProfileEditorModal
        editor={editor}
        level={editor?.mode === 'edit' ? (profiles.find((p) => p.id === editor.id)?.level ?? 1) : 1}
        name={name}
        avatarId={avatarId}
        onName={setName}
        onAvatar={setAvatarId}
        onSave={saveEditor}
        onClose={() => setEditor(null)}
      />

      <Modal
        open={!!deleting}
        title="Delete profile?"
        onClose={() => setDeleting(null)}
        actions={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} data-autofocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deleting) {
                  remove(deleting.id);
                  toast(`Profile “${deleting.name}” deleted.`, 'info');
                }
                setDeleting(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        <b className="text-fg">{deleting?.name}</b> (level {deleting?.level}) and all of their XP
        and stats will be removed permanently.
      </Modal>
    </ScreenShell>
  );
}

function ProfileEditorModal({
  editor,
  level = 1,
  name,
  avatarId,
  onName,
  onAvatar,
  onSave,
  onClose,
}: {
  editor: Editor;
  level?: number;
  name: string;
  avatarId: string;
  onName: (v: string) => void;
  onAvatar: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!editor}
      title={editor?.mode === 'edit' ? 'Edit profile' : 'New profile'}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave} disabled={!cleanName(name)}>
            {editor?.mode === 'edit' ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      <ProfileForm
        level={level}
        name={name}
        avatarId={avatarId}
        onName={onName}
        onAvatar={onAvatar}
        onSubmit={onSave}
      />
    </Modal>
  );
}
