import React, { useState, useEffect } from 'react';
import {
  Table,
  Card,
  Row,
  Col,
  Statistic,
  Progress,
  Space,
  Button,
  Modal,
  message,
  Tag,
} from 'antd';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import axios from 'axios';
import 'leaflet/dist/leaflet.css';

interface DeliveryAgent {
  id: string;
  name: string;
  phone: string;
  isAvailable: boolean;
  lastKnownLocation: {
    latitude: number;
    longitude: number;
  };
  currentDeliveries: number;
  maxWorkload: number;
  successRate: number;
  totalDeliveries: number;
  remittanceRating: number;
}

const DeliveryMonitoring: React.FC = () => {
  const [agents, setAgents] = useState<DeliveryAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<DeliveryAgent | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const fetchAgents = async () => {
    try {
      const response = await axios.get('/api/agents');
      setAgents(response.data);
      setLoading(false);
    } catch (error) {
      message.error('Failed to fetch delivery agents');
      console.error('Error fetching agents:', error);
    }
  };

  const handleToggleAvailability = async (agentId: string, currentStatus: boolean) => {
    try {
      await axios.post(`/api/agents/${agentId}/availability`, {
        isAvailable: !currentStatus,
      });
      message.success('Agent availability updated');
      fetchAgents();
    } catch (error) {
      message.error('Failed to update agent availability');
      console.error('Error updating availability:', error);
    }
  };

  const getWorkloadColor = (current: number, max: number) => {
    const percentage = (current / max) * 100;
    if (percentage >= 90) return 'red';
    if (percentage >= 70) return 'orange';
    return 'green';
  };

  const columns = [
    {
      title: 'Agent',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: DeliveryAgent) => (
        <Space direction="vertical">
          <span>{text}</span>
          <Tag color={record.isAvailable ? 'green' : 'red'}>
            {record.isAvailable ? 'Available' : 'Unavailable'}
          </Tag>
        </Space>
      ),
    },
    {
      title: 'Workload',
      key: 'workload',
      render: (text: string, record: DeliveryAgent) => (
        <Progress
          percent={(record.currentDeliveries / record.maxWorkload) * 100}
          strokeColor={getWorkloadColor(record.currentDeliveries, record.maxWorkload)}
          format={() => `${record.currentDeliveries}/${record.maxWorkload}`}
        />
      ),
    },
    {
      title: 'Success Rate',
      dataIndex: 'successRate',
      key: 'successRate',
      render: (rate: number) => (
        <Progress
          type="circle"
          percent={rate * 100}
          width={50}
          format={(percent) => `${percent?.toFixed(1)}%`}
        />
      ),
    },
    {
      title: 'Remittance Rating',
      dataIndex: 'remittanceRating',
      key: 'remittanceRating',
      render: (rating: number) => (
        <Progress
          type="circle"
          percent={rating * 100}
          width={50}
          strokeColor={rating >= 0.9 ? '#52c41a' : rating >= 0.7 ? '#faad14' : '#f5222d'}
          format={(percent) => `${percent?.toFixed(1)}%`}
        />
      ),
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (text: string, record: DeliveryAgent) => (
        <Space>
          <Button
            type="link"
            onClick={() => {
              setSelectedAgent(record);
              setDetailsVisible(true);
            }}
          >
            Details
          </Button>
          <Button
            type={record.isAvailable ? 'default' : 'primary'}
            onClick={() => handleToggleAvailability(record.id, record.isAvailable)}
          >
            {record.isAvailable ? 'Set Unavailable' : 'Set Available'}
          </Button>
        </Space>
      ),
    },
  ];

  const renderAgentDetails = () => {
    if (!selectedAgent) return null;

    return (
      <Modal
        title={`Agent Details - ${selectedAgent.name}`}
        visible={detailsVisible}
        onCancel={() => setDetailsVisible(false)}
        footer={null}
        width={800}
      >
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Card>
              <Statistic
                title="Total Deliveries"
                value={selectedAgent.totalDeliveries}
              />
            </Card>
          </Col>
          <Col span={12}>
            <Card>
              <Statistic
                title="Success Rate"
                value={selectedAgent.successRate * 100}
                suffix="%"
                precision={1}
              />
            </Card>
          </Col>
          <Col span={24}>
            <Card title="Current Location">
              <div style={{ height: '400px', width: '100%' }}>
                <MapContainer
                  center={[
                    selectedAgent.lastKnownLocation.latitude,
                    selectedAgent.lastKnownLocation.longitude,
                  ]}
                  zoom={13}
                  style={{ height: '100%', width: '100%' }}
                >
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
                  <Marker
                    position={[
                      selectedAgent.lastKnownLocation.latitude,
                      selectedAgent.lastKnownLocation.longitude,
                    ]}
                  >
                    <Popup>
                      {selectedAgent.name}
                      <br />
                      Last updated: {new Date().toLocaleTimeString()}
                    </Popup>
                  </Marker>
                </MapContainer>
              </div>
            </Card>
          </Col>
        </Row>
      </Modal>
    );
  };

  return (
    <div>
      <h1>Delivery Agent Monitoring</h1>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="Active Agents"
              value={agents.filter(a => a.isAvailable).length}
              suffix={`/ ${agents.length}`}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Total Deliveries Today"
              value={agents.reduce((sum, agent) => sum + agent.currentDeliveries, 0)}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Average Success Rate"
              value={
                agents.reduce((sum, agent) => sum + agent.successRate, 0) /
                (agents.length || 1) *
                100
              }
              suffix="%"
              precision={1}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="Average Remittance Rating"
              value={
                agents.reduce((sum, agent) => sum + agent.remittanceRating, 0) /
                (agents.length || 1) *
                100
              }
              suffix="%"
              precision={1}
            />
          </Card>
        </Col>
      </Row>
      <Table
        columns={columns}
        dataSource={agents}
        loading={loading}
        rowKey="id"
        pagination={false}
      />
      {renderAgentDetails()}
    </div>
  );
};

export default DeliveryMonitoring; 