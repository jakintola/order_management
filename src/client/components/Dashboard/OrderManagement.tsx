import React, { useState, useEffect } from 'react';
import {
  Table,
  Badge,
  Button,
  Space,
  Modal,
  message,
  Card,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import axios from 'axios';

const { TabPane } = Tabs;
const { confirm } = Modal;

interface Order {
  id: string;
  orderNumber: string;
  status: string;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  fraudScore: number;
  customer: {
    name: string;
    phone: string;
  };
  deliveries: Array<{
    id: string;
    status: string;
    agent: {
      name: string;
      phone: string;
    };
    currentLocation?: {
      latitude: number;
      longitude: number;
    };
  }>;
}

const OrderManagement: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchOrders = async () => {
    try {
      const response = await axios.get('/api/orders');
      setOrders(response.data);
      setLoading(false);
    } catch (error) {
      message.error('Failed to fetch orders');
      console.error('Error fetching orders:', error);
    }
  };

  const handleApproveOrder = async (orderId: string) => {
    try {
      await axios.post(`/api/orders/${orderId}/approve`);
      message.success('Order approved successfully');
      fetchOrders();
    } catch (error) {
      message.error('Failed to approve order');
      console.error('Error approving order:', error);
    }
  };

  const handleRejectOrder = async (orderId: string) => {
    confirm({
      title: 'Are you sure you want to reject this order?',
      icon: <ExclamationCircleOutlined />,
      content: 'This action cannot be undone.',
      onOk: async () => {
        try {
          await axios.post(`/api/orders/${orderId}/reject`);
          message.success('Order rejected successfully');
          fetchOrders();
        } catch (error) {
          message.error('Failed to reject order');
          console.error('Error rejecting order:', error);
        }
      },
    });
  };

  const handleReassignDelivery = async (deliveryId: string) => {
    try {
      await axios.post(`/api/deliveries/${deliveryId}/reassign`);
      message.success('Delivery reassigned successfully');
      fetchOrders();
    } catch (error) {
      message.error('Failed to reassign delivery');
      console.error('Error reassigning delivery:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusColors: { [key: string]: string } = {
      PENDING: 'default',
      CONFIRMED: 'processing',
      PROCESSING: 'processing',
      READY_FOR_DELIVERY: 'warning',
      IN_DELIVERY: 'warning',
      DELIVERED: 'success',
      CANCELLED: 'error',
      RETURNED: 'error',
    };
    return <Badge status={statusColors[status] as any} text={status} />;
  };

  const getFraudScoreBadge = (score: number) => {
    let color = 'success';
    if (score >= 0.7) color = 'error';
    else if (score >= 0.4) color = 'warning';
    return (
      <Tooltip title={`Fraud Score: ${(score * 100).toFixed(1)}%`}>
        <Tag color={color}>{(score * 100).toFixed(1)}%</Tag>
      </Tooltip>
    );
  };

  const columns = [
    {
      title: 'Order Number',
      dataIndex: 'orderNumber',
      key: 'orderNumber',
    },
    {
      title: 'Customer',
      dataIndex: 'customer',
      key: 'customer',
      render: (customer: any) => (
        <span>{customer.name}<br/>{customer.phone}</span>
      ),
    },
    {
      title: 'Amount',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      render: (amount: number) => `$${amount.toFixed(2)}`,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: getStatusBadge,
    },
    {
      title: 'Risk Score',
      dataIndex: 'fraudScore',
      key: 'fraudScore',
      render: getFraudScoreBadge,
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (text: string, record: Order) => (
        <Space>
          <Button
            type="link"
            onClick={() => {
              setSelectedOrder(record);
              setDetailsVisible(true);
            }}
          >
            Details
          </Button>
          {record.fraudScore >= 0.7 && record.status === 'PENDING' && (
            <>
              <Button
                type="primary"
                onClick={() => handleApproveOrder(record.id)}
              >
                Approve
              </Button>
              <Button
                danger
                onClick={() => handleRejectOrder(record.id)}
              >
                Reject
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  const renderOrderDetails = () => {
    if (!selectedOrder) return null;

    return (
      <Modal
        title={`Order Details - ${selectedOrder.orderNumber}`}
        visible={detailsVisible}
        onCancel={() => setDetailsVisible(false)}
        footer={null}
        width={800}
      >
        <Tabs defaultActiveKey="1">
          <TabPane tab="Order Information" key="1">
            <Card>
              <p><strong>Customer:</strong> {selectedOrder.customer.name}</p>
              <p><strong>Phone:</strong> {selectedOrder.customer.phone}</p>
              <p><strong>Amount:</strong> ${selectedOrder.totalAmount.toFixed(2)}</p>
              <p><strong>Payment Method:</strong> {selectedOrder.paymentMethod}</p>
              <p><strong>Payment Status:</strong> {selectedOrder.paymentStatus}</p>
              <p><strong>Fraud Score:</strong> {(selectedOrder.fraudScore * 100).toFixed(1)}%</p>
            </Card>
          </TabPane>
          <TabPane tab="Delivery Information" key="2">
            {selectedOrder.deliveries.map((delivery) => (
              <Card key={delivery.id} style={{ marginBottom: 16 }}>
                <p><strong>Status:</strong> {getStatusBadge(delivery.status)}</p>
                <p><strong>Agent:</strong> {delivery.agent?.name || 'Not assigned'}</p>
                {delivery.agent?.phone && (
                  <p><strong>Agent Phone:</strong> {delivery.agent.phone}</p>
                )}
                {delivery.currentLocation && (
                  <p>
                    <strong>Current Location:</strong>
                    <br />
                    Lat: {delivery.currentLocation.latitude}
                    <br />
                    Long: {delivery.currentLocation.longitude}
                  </p>
                )}
                <Button
                  type="primary"
                  onClick={() => handleReassignDelivery(delivery.id)}
                >
                  Reassign Delivery Agent
                </Button>
              </Card>
            ))}
          </TabPane>
        </Tabs>
      </Modal>
    );
  };

  return (
    <div>
      <h1>Order Management</h1>
      <Table
        columns={columns}
        dataSource={orders}
        loading={loading}
        rowKey="id"
        pagination={{ pageSize: 10 }}
      />
      {renderOrderDetails()}
    </div>
  );
};

export default OrderManagement; 