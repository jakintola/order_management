import React from 'react';
import { Layout, Menu } from 'antd';
import {
  ShoppingCartOutlined,
  CarOutlined,
  SecurityScanOutlined,
} from '@ant-design/icons';
import OrderManagement from './OrderManagement';
import DeliveryMonitoring from './DeliveryMonitoring';
import FraudPrevention from './FraudPrevention';

const { Content, Sider } = Layout;

const Dashboard: React.FC = () => {
  const [selectedMenu, setSelectedMenu] = React.useState('1');

  const renderContent = () => {
    switch (selectedMenu) {
      case '1':
        return <OrderManagement />;
      case '2':
        return <DeliveryMonitoring />;
      case '3':
        return <FraudPrevention />;
      default:
        return <OrderManagement />;
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={200}>
        <Menu
          mode="inline"
          selectedKeys={[selectedMenu]}
          style={{ height: '100%', borderRight: 0 }}
          onSelect={({ key }) => setSelectedMenu(key)}
        >
          <Menu.Item key="1" icon={<ShoppingCartOutlined />}>
            Order Management
          </Menu.Item>
          <Menu.Item key="2" icon={<CarOutlined />}>
            Delivery Monitoring
          </Menu.Item>
          <Menu.Item key="3" icon={<SecurityScanOutlined />}>
            Fraud Prevention
          </Menu.Item>
        </Menu>
      </Sider>
      <Layout style={{ padding: '24px' }}>
        <Content
          style={{
            padding: 24,
            margin: 0,
            minHeight: 280,
            background: '#fff',
          }}
        >
          {renderContent()}
        </Content>
      </Layout>
    </Layout>
  );
};

export default Dashboard; 