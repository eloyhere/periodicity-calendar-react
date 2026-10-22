interface PlaceholderPageProps {
    title: string;
}

function PlaceholderPage({ title }: PlaceholderPageProps) {
    return (
        <section className="page-placeholder">
            <h1>{title}</h1>
            <p>该页面尚未实现，等待具体需求。</p>
        </section>
    );
}

export default PlaceholderPage;
