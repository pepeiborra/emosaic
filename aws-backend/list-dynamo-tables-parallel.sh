#!/bin/bash

# Fetch all enabled region names
REGIONS=$(aws ec2 describe-regions --all-regions --query "Regions[].RegionName" --output text --region us-east-1)

echo "Searching for DynamoDB tables across all regions using GNU Parallel..."

# Define a function to list tables in a single region
list_tables_in_region() {
    local region=$1
    echo "--- Checking Region: $region ---"
    TABLES=$(aws dynamodb list-tables --region $region --query "TableNames[]" --output text || true)
    if [ -n "$TABLES" ]; then
        for table in $TABLES; do
            echo "- Region: $region, Table: $table"
        done
    # else
        # echo "No DynamoDB tables found in $region."
    fi
}

# Export the function so GNU Parallel can access it in sub-shells
export -f list_tables_in_region

# Run the function in parallel for each region
parallel -j 0 list_tables_in_region ::: $REGIONS

echo "--- Search complete ---"
