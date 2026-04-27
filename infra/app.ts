import * as cdk from 'aws-cdk-lib';
import { StatefulStack } from './stateful/stateful-stack.js';
import { StatelessStack } from './stateless/stateless-stack.js';

const app = new cdk.App();
new StatefulStack(app, 'HeirloomStatefulStack');
new StatelessStack(app, 'HeirloomStatelessStack');
