"use client";

import { Card, CardBody } from "@heroui/react";

type FeatureCardProps = {
  title: string;
  description: string;
  className?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export function FeatureCard({ title, description, className, titleClassName, descriptionClassName }: FeatureCardProps) {
  return (
    <Card className={className}>
      <CardBody>
        <h3 className={titleClassName}>{title}</h3>
        <p className={descriptionClassName}>{description}</p>
      </CardBody>
    </Card>
  );
}
