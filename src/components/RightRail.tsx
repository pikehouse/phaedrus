import { useState } from 'react';
import { useSonos } from '../store/useSonos';
import Queue from './Queue';
import Crate from './Crate';
import { Search } from './Icons';
import '../styles/rightrail.css';

type Tab = 'queue' | 'crate';

export default function RightRail() {
  const [tab, setTab] = useState<Tab>('queue');
  const setSearchOpen = useSonos((s) => s.setSearchOpen);

  return (
    <aside className="rail right-rail">
      <div className="right-drag" data-tauri-drag-region />

      <div className="right-tabs" role="tablist" aria-label="Queue and favourites">
        <div className="right-tabs-set">
          {(['queue', 'crate'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`right-tab label${tab === t ? ' is-active' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="right-search"
          aria-label="Search music (Command K)"
          onClick={() => setSearchOpen(true)}
        >
          <Search size={16} />
        </button>
      </div>

      {tab === 'queue' ? <Queue /> : <Crate />}
    </aside>
  );
}
