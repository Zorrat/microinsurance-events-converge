import styles from "@/app/components/workflow/workflow-ui.module.css";

type ResultPanelProps = {
  title: string;
  raw: string;
};

export function ResultPanel({ title, raw }: ResultPanelProps) {
  if (!raw) return null;

  return (
    <div className={styles.resultPanel}>
      <h3 className={styles.resultHeader}>{title}</h3>
      <pre className={styles.resultBody}>{raw}</pre>
    </div>
  );
}
