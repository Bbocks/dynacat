import { clamp } from "./utils.js";

/**
 * Arranges the widgets inside each `.masonry` container into responsive
 * columns and keeps them arranged across live updates, resizes, and
 * visibility changes.
 */
export function setupMasonries() {
    const masonryContainers = document.getElementsByClassName("masonry");

    for (let i = 0; i < masonryContainers.length; i++) {
        const container = masonryContainers[i];

        if (container.dataset.initialized) continue;
        container.dataset.initialized = "true";

        const options = {
            minColumnWidth: container.dataset.minColumnWidth || 330,
            maxColumns: container.dataset.maxColumns || 6,
        };

        let previousColumnsCount = 0;

        // Re-derive the wrapped items on every render instead of caching them
        // once at setup. Live updates (SSE morphs / polling content swaps)
        // replace the masonry's children with unwrapped widgets, so a cached
        // item list would go stale, and the column structure has to be
        // recoverable from whatever is currently inside the container.
        const collectState = () => {
            const columns = [];
            const loose = [];

            for (const child of container.children) {
                (child.classList.contains("masonry-column") ? columns : loose).push(child);
            }

            // Items are distributed round-robin across the columns, so
            // walking the columns row by row reconstructs the original item
            // order (a plain column-by-column walk would shuffle it).
            const items = [];
            const rows = columns.length > 0 ? Math.max(...columns.map(c => c.children.length)) : 0;

            for (let row = 0; row < rows; row++) {
                for (const column of columns) {
                    if (row < column.children.length) {
                        items.push(column.children[row]);
                    }
                }
            }

            return {
                items: items.concat(loose),
                hasColumns: columns.length > 0,
                hasLoose: loose.length > 0,
            };
        };

        const render = function() {
            const { items, hasColumns, hasLoose } = collectState();

            const columnsCount = clamp(
                Math.floor(container.offsetWidth / options.minColumnWidth),
                1,
                Math.min(options.maxColumns, items.length)
            );

            // Only skip the rebuild when the columns are present, nothing is
            // sitting outside them, and the count is unchanged - live updates
            // can strip the columns or leave new widgets unwrapped while the
            // count still looks "correct".
            if (hasColumns && !hasLoose && columnsCount === previousColumnsCount) {
                return;
            }

            container.textContent = "";
            previousColumnsCount = columnsCount;

            const columnsFragment = document.createDocumentFragment();

            for (let i = 0; i < columnsCount; i++) {
                const column = document.createElement("div");
                column.className = "masonry-column";
                columnsFragment.append(column);
            }

            for (let i = 0; i < items.length; i++) {
                columnsFragment.children[i % columnsCount].appendChild(items[i]);
            }

            container.append(columnsFragment);
        };

        // A morph reuses the container while wiping data-initialized, so it drops the previous observer.
        if (container._masonryObserver) {
            container._masonryObserver.disconnect();
        }

        // Render synchronously instead of only on the next resize/rAF tick.
        // Live updates mutate this container's children within the same task
        // (an SSE morph or content swap leaves the widgets unwrapped), and the
        // browser would otherwise paint that intermediate unwrapped - squashed
        // - state for a frame or two before the ResizeObserver/rAF pass could
        // rebuild the columns, which shows up as flashing on every update.
        // Skipped while hidden (offsetWidth 0, e.g. before the page reveal on
        // initial load) - a hidden container cannot flash, and the observer
        // below takes over once it becomes visible.
        if (container.offsetWidth > 0) {
            render();
        }

        const observer = new ResizeObserver(() => requestAnimationFrame(render));
        container._masonryObserver = observer;
        observer.observe(container);
    }
}
