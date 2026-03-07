"use client";

import { Card, CardBody } from "@heroui/react";

type FlowStepProps = {
  index: number;
  title: string;
  description: string;
  className?: string;
  indexClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export function FlowStep({
  index,
  title,
  description,
  className,
  indexClassName,
  titleClassName,
  descriptionClassName,
}: FlowStepProps) {
  return (
    <Card className={className}>
      <CardBody>
        <div className={indexClassName}>{index}</div>
        <h3 className={titleClassName}>{title}</h3>
        <p className={descriptionClassName}>{description}</p>
      </CardBody>
    </Card>
  );
}
