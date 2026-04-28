import * as cdk from 'aws-cdk-lib';
import { StatefulStack } from './stateful/stateful-stack.js';
import { StatelessStack } from './stateless/stateless-stack.js';

const app = new cdk.App();
const stateful = new StatefulStack(app, 'HeirloomStatefulStack');
new StatelessStack(app, 'HeirloomStatelessStack', {
  imagesBucket: stateful.imagesBucket,
  recipesTable: stateful.recipesTable,
  jobsTable: stateful.jobsTable,
});
