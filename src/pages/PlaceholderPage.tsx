import { PeriodicityCard, PeriodicityEmptyState, PeriodicityTag } from "periodicity-react";
import type { PeriodicityIconName } from "periodicity-react";

interface PlaceholderPageProps {
    title: string;
    icon: PeriodicityIconName;
}

function PlaceholderPage({ title, icon }: PlaceholderPageProps) {
    return (
        <section className="page-placeholder">
            <div className="page-placeholder__content">
                <PeriodicityCard title={title} action={<PeriodicityTag tone="neutral">待实现</PeriodicityTag>}>
                    <PeriodicityEmptyState
                        icon={icon}
                        title={`${title}即将上线`}
                        description="该页面尚未实现，等待具体需求。"
                    />
                </PeriodicityCard>
            </div>
        </section>
    );
}

export default PlaceholderPage;
