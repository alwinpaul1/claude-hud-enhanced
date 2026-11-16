import { yellow, green, label } from "./colors.js";
import { t } from "../i18n/index.js";
import { truncateString } from "../utils/truncate.js";
import { firstFitting } from "./visual.js";
const CONTENT_LENGTHS = [50, 36, 24, 14];
export function renderTodosLine(ctx, fits) {
    const { todos } = ctx.transcript;
    const colors = ctx.config?.colors;
    if (!todos || todos.length === 0) {
        return null;
    }
    const inProgress = todos.find((todo) => todo.status === "in_progress");
    const completed = todos.filter((todo) => todo.status === "completed").length;
    const total = todos.length;
    if (!inProgress) {
        if (completed === total && total > 0) {
            return `${green("✓")} ${t("status.allTodosComplete")} ${label(`(${completed}/${total})`, colors)}`;
        }
        return null;
    }
    const progress = label(`(${completed}/${total})`, colors);
    return firstFitting([
        ...CONTENT_LENGTHS.map((length) => () => `${yellow("▸")} ${truncateString(inProgress.content, length)} ${progress}`),
        () => `${yellow("▸")} ${progress}`,
    ], fits);
}
//# sourceMappingURL=todos-line.js.map