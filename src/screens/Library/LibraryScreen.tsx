import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import Sheet from '../../components/Sheet';
import { db } from '../../db/db';
import { updateFood, updateMeal } from '../../db/repo';
import { fmtG } from '../../lib/fiber';
import { useNav } from '../../nav';
import { SLOT_LABELS, type Food, type Meal } from '../../types';
import { filterAndSortLibrary } from '../../lib/librarySort';
import './library.css';

type LibTab = 'foods' | 'meals';

export default function LibraryScreen() {
  const { openModal } = useNav();
  const [libTab, setLibTab] = useState<LibTab>('foods');
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const foods = useLiveQuery(() => db.foods.toArray(), []);
  const meals = useLiveQuery(() => db.meals.toArray(), []);

  const shownFoods = filterAndSortLibrary(foods ?? [], search);
  const shownMeals = filterAndSortLibrary(meals ?? [], search);
  const searching = search.trim().length > 0;

  function pickLane(lane: 'scanLabel' | 'scanList' | 'importLink' | 'foodForm' | 'mealBuilder') {
    setAddOpen(false);
    openModal({ type: lane });
  }

  return (
    <div className="screen-scroll lb-screen">
      <p className="screen-kicker">Enter once, reuse forever</p>
      <h1 className="screen-title lb-title">Library</h1>

      <input
        className="lb-search"
        type="search"
        placeholder="Search by name or brand"
        aria-label="Search your library"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="lb-seg" role="tablist" aria-label="Foods or meals">
        <button
          role="tab"
          aria-selected={libTab === 'foods'}
          className={libTab === 'foods' ? 'on' : ''}
          onClick={() => setLibTab('foods')}
        >
          Foods
        </button>
        <button
          role="tab"
          aria-selected={libTab === 'meals'}
          className={libTab === 'meals' ? 'on' : ''}
          onClick={() => setLibTab('meals')}
        >
          Meals
        </button>
      </div>

      {libTab === 'foods' &&
        foods !== undefined &&
        (shownFoods.length > 0 ? (
          <div className="card row-list">
            {shownFoods.map((f) => (
              <FoodRow key={f.id} food={f} />
            ))}
          </div>
        ) : searching ? (
          <div className="empty-note">
            Nothing matches “{search.trim()}” yet.
            <button
              className="btn btn-primary lb-lookup-cta"
              onClick={() => openModal({ type: 'foodForm', initialName: search.trim() })}
            >
              🔎 Look up “{search.trim()}” fiber
            </button>
            <span className="small muted lb-lookup-or">or tap + to scan a label</span>
          </div>
        ) : (
          <p className="empty-note">
            No foods here yet.
            <br />
            Tap + to scan a nutrition label or type a food in — you only ever enter it once.
          </p>
        ))}

      {libTab === 'meals' &&
        meals !== undefined &&
        (shownMeals.length > 0 ? (
          <div className="card row-list">
            {shownMeals.map((m) => (
              <MealRow key={m.id} meal={m} />
            ))}
          </div>
        ) : searching ? (
          <p className="empty-note">
            Nothing matches “{search.trim()}” yet.
            <br />
            Tap + and choose “Build a meal” to create it.
          </p>
        ) : (
          <p className="empty-note">
            No meals yet.
            <br />
            Tap + and choose “Build a meal” to combine foods you already have — the fiber adds
            itself up.
          </p>
        ))}

      <button className="lb-fab" aria-label="Add to library" onClick={() => setAddOpen(true)}>
        +
      </button>

      {addOpen && (
        <Sheet title="Add to library" onClose={() => setAddOpen(false)}>
          <div className="lb-add-list">
            <button className="lb-add-opt" onClick={() => pickLane('scanLabel')}>
              <span className="lb-add-ico" aria-hidden="true">
                📷
              </span>
              <span>
                <span className="lb-add-name">Scan a nutrition label</span>
                <span className="lb-add-sub small muted">
                  Snap the panel — the numbers fill themselves in
                </span>
              </span>
            </button>
            <button className="lb-add-opt" onClick={() => pickLane('scanList')}>
              <span className="lb-add-ico" aria-hidden="true">
                📝
              </span>
              <span>
                <span className="lb-add-name">Scan a list of foods</span>
                <span className="lb-add-sub small muted">
                  A handwritten or typed list — every food added at once
                </span>
              </span>
            </button>
            <button className="lb-add-opt" onClick={() => pickLane('importLink')}>
              <span className="lb-add-ico" aria-hidden="true">
                🔗
              </span>
              <span>
                <span className="lb-add-name">From a link (Home Chef)</span>
                <span className="lb-add-sub small muted">
                  Paste a recipe link — name and fiber fill themselves in
                </span>
              </span>
            </button>
            <button className="lb-add-opt" onClick={() => pickLane('foodForm')}>
              <span className="lb-add-ico" aria-hidden="true">
                ✏️
              </span>
              <span>
                <span className="lb-add-name">Type a food in</span>
                <span className="lb-add-sub small muted">Name, serving, and fiber — done</span>
              </span>
            </button>
            <button className="lb-add-opt" onClick={() => pickLane('mealBuilder')}>
              <span className="lb-add-ico" aria-hidden="true">
                🍽
              </span>
              <span>
                <span className="lb-add-name">Build a meal</span>
                <span className="lb-add-sub small muted">
                  Combine foods you have — total computed for you
                </span>
              </span>
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function FoodRow({ food }: { food: Food }) {
  const { openModal } = useNav();
  const sub = [food.brand, food.servingLabel].filter(Boolean).join(' · ');
  return (
    <div className="lb-row">
      <button
        className={food.favorite ? 'lb-star on' : 'lb-star'}
        aria-pressed={food.favorite}
        aria-label={`${food.favorite ? 'Remove favorite' : 'Favorite'}: ${food.name}`}
        onClick={() => {
          if (food.id != null) void updateFood(food.id, { favorite: !food.favorite });
        }}
      >
        {food.favorite ? '★' : '☆'}
      </button>
      <button
        className="lb-row-main"
        onClick={() => openModal({ type: 'foodForm', foodId: food.id })}
      >
        <span className="lb-row-text">
          <span className="lb-row-name">
            <span className="lb-row-name-text">{food.name}</span>
            {food.source === 'estimate' && <span className="lb-est">est.</span>}
          </span>
          {sub && <span className="lb-row-sub small muted">{sub}</span>}
        </span>
        <span className="grams lb-row-g">{fmtG(food.fiberPerServing)} g</span>
      </button>
      {food.sourceUrl && (
        <a
          className="lb-src"
          href={food.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open the source page for ${food.name} to confirm its fiber`}
          title="Open source page"
          onClick={(e) => e.stopPropagation()}
        >
          ↗
        </a>
      )}
    </div>
  );
}

function MealRow({ meal }: { meal: Meal }) {
  const { openModal } = useNav();
  const count = meal.items.length;
  const sub = [
    count === 1 ? '1 ingredient' : `${count} ingredients`,
    meal.slotHint ? SLOT_LABELS[meal.slotHint] : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="lb-row">
      <button
        className={meal.favorite ? 'lb-star on' : 'lb-star'}
        aria-pressed={meal.favorite}
        aria-label={`${meal.favorite ? 'Remove favorite' : 'Favorite'}: ${meal.name}`}
        onClick={() => {
          if (meal.id != null) void updateMeal(meal.id, { favorite: !meal.favorite });
        }}
      >
        {meal.favorite ? '★' : '☆'}
      </button>
      <button
        className="lb-row-main"
        onClick={() => openModal({ type: 'mealBuilder', mealId: meal.id })}
      >
        <span className="lb-row-text">
          <span className="lb-row-name">
            <span className="lb-row-name-text">{meal.name}</span>
          </span>
          <span className="lb-row-sub small muted">{sub}</span>
        </span>
        <span className="grams lb-row-g">{fmtG(meal.totalFiber)} g</span>
      </button>
    </div>
  );
}
