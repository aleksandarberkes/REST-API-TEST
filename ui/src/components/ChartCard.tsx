import { useRef, type ReactNode } from 'react';

/** Card wrapper for a chart, with a button that exports the chart as a PNG (for the paper). */
export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  const exportPng = () => {
    const svg = ref.current?.querySelector<SVGSVGElement>('svg.recharts-surface');
    if (!svg) return;
    const { width, height } = svg.getBoundingClientRect();
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale + 40 * scale;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height + 40);
      ctx.fillStyle = '#18181b';
      ctx.font = '600 14px -apple-system, Segoe UI, sans-serif';
      ctx.fillText(title, 12, 24);
      ctx.drawImage(img, 0, 40);
      const a = document.createElement('a');
      a.download = `${title.replace(/[^\w]+/g, '-').toLowerCase()}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  };

  return (
    <div className="card">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{title}</h4>
          {subtitle && <p className="hint mt-0.5">{subtitle}</p>}
        </div>
        <button className="btn px-2 py-0.5 text-xs" onClick={exportPng} title="Download as PNG">
          PNG
        </button>
      </div>
      <div ref={ref} className="h-64 w-full">
        {children}
      </div>
    </div>
  );
}

// Shared axis / grid / tooltip styling that reads well in light and dark mode.
export const axisProps = { stroke: '#a1a1aa', tick: { fill: '#71717a', fontSize: 11 }, tickLine: false } as const;
export const gridProps = { stroke: '#a1a1aa', strokeOpacity: 0.2, strokeDasharray: '3 3' } as const;
export const tooltipProps = {
  contentStyle: { background: '#18181b', border: 'none', borderRadius: 8, color: '#fafafa', fontSize: 12 },
  labelStyle: { color: '#a1a1aa' },
  itemStyle: { padding: 0 },
} as const;
export const legendProps = { wrapperStyle: { fontSize: 12 } } as const;
