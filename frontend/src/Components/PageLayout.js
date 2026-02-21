import Sidebar from './Sidebar';
import './PageLayout.css';

function PageLayout({ title, role, children }) {
  return (
    <div className="page-layout">
      <Sidebar role={role} />
      <div className="main">
        {title ? <h1>{title}</h1> : null}
        {children}
      </div>
    </div>
  );
}

export default PageLayout;
