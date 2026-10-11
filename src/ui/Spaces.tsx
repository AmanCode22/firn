import { useEffect, useRef, useState } from 'react';
import { SPACE_ICON_NAMES } from '../spaceIcons';
import type { Space, SpacesState } from '../types';
import { ChevronIcon, MoreIcon, PlusIcon } from './icons';
import { SpaceIcon } from './SpaceIcon';

// The active space's name above its pinned tabs. Click it to fold the
// pins away (or bring them back); the ... button (or right-click) has
// Rename, Change icon and Delete.
export function SpaceHeader({
  space,
  renaming,
  onDoneRenaming,
}: {
  space: Space | undefined;
  renaming: boolean;
  onDoneRenaming: () => void;
}) {
  if (!space) return null;
  const folded = !!space.pinsFolded;
  const toggleFold = () => {
    if (!renaming) window.firn.updateSpace(space.id, { pinsFolded: !folded });
  };
  return (
    <div
      className={`space-header ${folded ? 'is-folded' : ''}`}
      title={folded ? 'Show pinned tabs' : 'Fold pinned tabs away'}
      onClick={toggleFold}
      onContextMenu={(e) => {
        e.preventDefault();
        window.firn.showSpaceMenu(space.id);
      }}
    >
      {/* The space's icon, which turns into a fold arrow on hover. */}
      <span className="space-header-icon">
        <span className="space-header-symbol">
          <SpaceIcon name={space.icon} />
        </span>
        <span className="space-header-chevron">
          <ChevronIcon />
        </span>
      </span>
      {renaming ? (
        <SpaceNameInput space={space} onDone={onDoneRenaming} />
      ) : (
        <span className="space-header-name">{space.name}</span>
      )}
      <button
        className="space-header-more"
        title="Space options"
        onClick={(e) => {
          e.stopPropagation();
          window.firn.showSpaceMenu(space.id);
        }}
      >
        <MoreIcon />
      </button>
    </div>
  );
}

function SpaceNameInput({
  space,
  onDone,
}: {
  space: Space;
  onDone: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(space.name);
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && name.trim() && name.trim() !== space.name)
      window.firn.updateSpace(space.id, { name });
    onDone();
  };

  return (
    <input
      ref={input}
      className="space-header-input"
      value={name}
      maxLength={40}
      spellCheck={false}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

// The row of space icons at the bottom of the sidebar: click to switch,
// right-click for rename / icon / delete, + for a new space.
export function SpaceSwitcher({ spaces, activeSpaceId }: SpacesState) {
  return (
    <nav className="space-switcher" aria-label="Spaces">
      {spaces.map((space, i) => (
        <button
          key={space.id}
          className={`space-dot ${space.id === activeSpaceId ? 'is-active' : ''}`}
          data-testid="space"
          data-space={space.name}
          title={i < 9 ? `${space.name}  (Ctrl+Shift+${i + 1})` : space.name}
          onClick={() => window.firn.switchSpace(space.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            window.firn.showSpaceMenu(space.id);
          }}
        >
          <SpaceIcon name={space.icon} />
        </button>
      ))}
      <button
        className="space-dot space-add"
        title="New space"
        onClick={() => window.firn.newSpace()}
      >
        <PlusIcon />
      </button>
    </nav>
  );
}

// "Change icon…": a small grid of icons under the space's name. Picking one
// (or Esc, or clicking elsewhere) closes it.
export function SpaceIconPicker({
  space,
  top,
  onDone,
}: {
  space: Space;
  top: number;
  onDone: () => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    grid.current
      ?.querySelector<HTMLButtonElement>('.is-current, button')
      ?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDone();
    const onPointer = (e: PointerEvent) => {
      if (!grid.current?.contains(e.target as Node)) onDone();
    };
    addEventListener('keydown', onKey);
    addEventListener('pointerdown', onPointer, true);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('pointerdown', onPointer, true);
    };
  }, [onDone]);

  return (
    <div
      ref={grid}
      className="space-icon-picker"
      style={{ top }}
      role="listbox"
      aria-label="Space icon"
    >
      {SPACE_ICON_NAMES.map((name) => (
        <button
          key={name}
          className={`space-icon-choice ${name === space.icon ? 'is-current' : ''}`}
          title={name[0].toUpperCase() + name.slice(1)}
          onClick={() => {
            window.firn.updateSpace(space.id, { icon: name });
            onDone();
          }}
        >
          <SpaceIcon name={name} />
        </button>
      ))}
    </div>
  );
}
