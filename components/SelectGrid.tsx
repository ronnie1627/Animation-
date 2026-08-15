"use client";

type Item = { id: string; name: string; description: string };

export default function SelectGrid({
  items,
  selectedId,
  onSelect
}: {
  items: Item[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {items.map((item) => {
        const active = item.id === selectedId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            className={`text-left p-4 rounded-xl border transition-colors ${
              active
                ? "border-signal bg-signal/10"
                : "border-line bg-panel/40 hover:border-signal/40"
            }`}
          >
            <p className="font-semibold text-sm">{item.name}</p>
            <p className="text-xs text-mist mt-1">{item.description}</p>
          </button>
        );
      })}
    </div>
  );
}
