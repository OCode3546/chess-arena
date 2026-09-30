import { Modal } from '@/components/ui';
import type { Color } from '@shared/types';
import { PIECE_NAME, pieceUrl } from '@/config/pieces';
import { useGameStore, type PromotionPiece } from '@/store/gameStore';

const CHOICES: PromotionPiece[] = ['q', 'r', 'b', 'n'];

export function PromotionPicker({ color, pieceSet }: { color: Color; pieceSet: string }) {
  const pending = useGameStore((s) => s.pendingPromotion);
  const choose = useGameStore((s) => s.choosePromotion);
  const cancel = useGameStore((s) => s.cancelPromotion);

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  return (
    // Keep clicks and keys inside the picker from reaching the board's handlers.
    <div onPointerDown={stop} onPointerUp={stop} onPointerMove={stop} onKeyDown={stop}>
      <Modal open={!!pending} title="Promote pawn" onClose={cancel} contained className="max-w-sm">
        <div className="grid grid-cols-4 gap-2">
          {CHOICES.map((p, i) => (
            <button
              key={p}
              type="button"
              data-autofocus={i === 0 ? '' : undefined}
              onClick={() => choose(p)}
              aria-label={`Promote to ${PIECE_NAME[p]}`}
              className="glass aspect-square cursor-pointer rounded-xl p-2 transition-transform hover:scale-105 hover:bg-surface-2"
            >
              <img
                src={pieceUrl(pieceSet, color, p)}
                alt=""
                draggable={false}
                className="h-full w-full"
              />
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
