import { clamp } from "./utils.js";

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
        const collectItems = () => {
            const items = [];

            for (const child of container.children) {
                if (child.classList.contains("masonry-column")) {
                    for (const item of child.children) {
                        items.push(item);
                    }
                } else {
                    items.push(child);
                }
            }

            return items;
        };

        const render = function() {
            const items = collectItems();
            const hasColumns = container.querySelector(":scope > .masonry-column") !== null;

            const columnsCount = clamp(
                Math.floor(container.offsetWidth / options.minColumnWidth),
                1,
                Math.min(options.maxColumns, items.length)
            );

            // Only skip the rebuild when the column count is unchanged AND the
            // columns are actually there - live updates can strip them while
            // leaving the count "correct".
            if (hasColumns && columnsCount === previousColumnsCount) {
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
