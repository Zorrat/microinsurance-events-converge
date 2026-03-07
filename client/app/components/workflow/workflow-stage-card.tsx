import type { ReactNode } from "react";

import styles from "@/app/components/workflow/workflow-ui.module.css";

type WorkflowStageCardProps = {
  step: number;
  title: string;
  summary: string;
  chips: string[];
  children: ReactNode;
};

export function WorkflowStageCard({ step, title, summary, chips, children }: WorkflowStageCardProps) {
  return (
    <section className={styles.stage}>
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

      <div className={styles.stageBody}>{children}</div>
    </section>
  );
}
