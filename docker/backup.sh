#!/bin/bash

# Configuration
BACKUP_DIR="/backups"
POSTGRES_USER="postgres"
POSTGRES_DB="project_bolt"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/backup_${DATE}.sql"

# Ensure backup directory exists
mkdir -p ${BACKUP_DIR}

# Create backup
echo "Creating backup of ${POSTGRES_DB}..."
pg_dump -U ${POSTGRES_USER} -d ${POSTGRES_DB} > ${BACKUP_FILE}

# Compress backup
echo "Compressing backup..."
gzip ${BACKUP_FILE}

# Keep only last 7 days of backups
echo "Cleaning old backups..."
find ${BACKUP_DIR} -type f -name "backup_*.sql.gz" -mtime +7 -delete

echo "Backup completed: ${BACKUP_FILE}.gz" 