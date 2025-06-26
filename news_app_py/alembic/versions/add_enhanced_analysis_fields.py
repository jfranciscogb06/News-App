"""add enhanced analysis fields

Revision ID: add_enhanced_fields
Revises: b9acd7afbe4b
Create Date: 2024-01-01 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_enhanced_fields'
down_revision = 'b9acd7afbe4b'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create enum types
    source_credibility_enum = postgresql.ENUM('HIGH', 'MEDIUM', 'LOW', name='sourcecredibility')
    source_credibility_enum.create(op.get_bind())
    
    # Add new columns
    op.add_column('news', sa.Column('confidence_score', sa.Float(), nullable=True))
    op.add_column('news', sa.Column('source_credibility', sa.Enum('HIGH', 'MEDIUM', 'LOW', name='sourcecredibility'), nullable=True))
    op.add_column('news', sa.Column('impact_score', sa.Float(), nullable=True))
    op.add_column('news', sa.Column('key_entities', postgresql.ARRAY(sa.String()), nullable=True))
    op.add_column('news', sa.Column('risk_factors', postgresql.ARRAY(sa.String()), nullable=True))


def downgrade() -> None:
    # Remove columns
    op.drop_column('news', 'risk_factors')
    op.drop_column('news', 'key_entities')
    op.drop_column('news', 'impact_score')
    op.drop_column('news', 'source_credibility')
    op.drop_column('news', 'confidence_score')
    
    # Drop enum type
    source_credibility_enum = postgresql.ENUM('HIGH', 'MEDIUM', 'LOW', name='sourcecredibility')
    source_credibility_enum.drop(op.get_bind()) 