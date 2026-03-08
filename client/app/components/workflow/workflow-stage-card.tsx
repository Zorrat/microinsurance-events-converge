import type { ReactNode } from "react";

import styles from "@/app/components/workflow/workflow-ui.module.css";

type WorkflowStageCardProps = {
  step: number;
  title: string;
  summary: string;
  chips: string[];
  expanded?: boolean;
  onOpenStage?: () => void;
  children: ReactNode;
};

export function WorkflowStageCard({
  step,
  title,
  summary,
  chips,
  expanded = true,
  onOpenStage,
  children,
}: WorkflowStageCardProps) {
  return (
    <section className={`${styles.stage} ${expanded ? styles.stageExpanded : styles.stageCollapsed}`}>
      <header className={styles.stageHeader}>
        <div className={styles.stageIndex}>STEP {step}</div>
        <div>
          <h2 className={styles.stageTitle}>{title}</h2>
          <p className={styles.stageSummary}>{summary}</p>
        </div>
      </header>

      <div className={styles.chipRow}>
        {chips.map((chip) => (
          <span key={chip} className={styles.stageChip}>
            {chip}
          </span>
        ))}
      </div>

      {expanded ? (
        <div className={styles.stageBody}>{children}</div>
      ) : (
        <div className={styles.stageCompactFooter}>
          {onOpenStage ? (
            <button type="button" className={styles.stageOpenButton} onClick={onOpenStage}>
              Open stage
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
