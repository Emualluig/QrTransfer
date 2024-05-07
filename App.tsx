import * as React from 'react';
import { StyleSheet, Text, View, Platform, TouchableOpacity, Button, Dimensions, Image, TextInput } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator, NativeStackScreenProps } from '@react-navigation/native-stack';
import { EncodingType, readAsStringAsync, documentDirectory, writeAsStringAsync } from 'expo-file-system';
import * as Sharing from "expo-sharing";
import * as DocumentPicker from 'expo-document-picker';
import { BarCodeScanner, BarCodeScannerResult } from 'expo-barcode-scanner';
import { QRCodeCanvas  } from 'qrcode.react';
import QRCode from 'react-native-qrcode-svg';

// Import buffer, may be removed in future
global.Buffer = require("buffer").Buffer

type DataType = { 
    name: null | string, 
    data: null | string, 
    isWeb: boolean 
};

type RootStackParamList = {
    HomeScreen: undefined;
    ReceiveScreen: undefined;
    TransmitScreenSelectFile: undefined;
    TransmitScreenDisplaying: {
        data: DataType
    };
    ReceiveCompleteScreen: {
        name: string
        data: string,
    }
};

type TransmitScreenSelectFileProps = NativeStackScreenProps<RootStackParamList, "TransmitScreenSelectFile">;
function TransmitScreenSelectFile({ navigation }: TransmitScreenSelectFileProps) {
    const pickDocument = async () => {
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
        if (result.canceled) {
            console.log("Pick document canceled");
            return;
        }
        const dataobj: DataType = {
            name: null,
            data: null,
            isWeb: false,
        };
        const assets = result.assets;
        if (assets.length !== 1) {
            console.log("Can only pick 1 document.");
            return;
        }
        const asset = result.assets.at(0)!;
        if (result.output === undefined) {
            console.log("On mobile");
            const content = await readAsStringAsync(asset.uri, { encoding: EncodingType.Base64 });

            dataobj.name = asset.name;
            dataobj.data = content;
        } else {
            console.log("On web");
            dataobj.name = asset.name;
            const base64 = asset.uri.split("base64,").at(1)!;
            dataobj.data = base64;
            dataobj.isWeb = true;
        }
        navigation.navigate("TransmitScreenDisplaying", { data: dataobj });
    }

    return (
        <View style={styles.container}>
            <Text>Select a file to start transmitting</Text>
            <TouchableOpacity>
                <Button title="Select your file" onPress={pickDocument} />
            </TouchableOpacity>
        </View>
    );
}

type TransmitScreenDisplayingProps = NativeStackScreenProps<RootStackParamList, "TransmitScreenDisplaying">;
function TransmitScreenDisplaying({ navigation, route }: TransmitScreenDisplayingProps) {
    const [ currentText, setCurrentText ] = React.useState<string|null>(null);

    React.useEffect(() => {
        const dataobj = route.params.data;
        const data = dataobj.data!;
        const name = dataobj.name!;

        /**
         * Encoding scheme:
         * Slice:
         *  Has if its the meta slice
         *  Has # of frags
         *  Has its frag index
         *  Has length of its data
         *  Has its data
         *  Padding if under the length by alot
         *  All seperated by ;
         * 1 Meta slice: Contains name as its data
         */
        
        // Determine the best speed/length combination
        // It depends on device since QRCodeCanvas is more performant but only available on web
        const speed = 150; // Lower is higher throughput
        const length = 750; // Higher is higher throughput

        const nfrags = Math.ceil(data.length/length);
        let index = nfrags;
        let metaslice = [1, nfrags, 0, name].join(";");
        if (metaslice.length < length) {
            metaslice += ";";
            metaslice = metaslice.padEnd(length - metaslice.length, "0");
        }
        const baseslice = [0, nfrags].join(";");
        const intervalId = setInterval(() => {
            if (index === nfrags) {
                // Show meta slice
                setCurrentText(metaslice);
                index = index % nfrags;
            } else {
                const dataslice = data.substring(index * length, index * length + length);
                let slice = `${baseslice};${index};${dataslice}`;
                if (slice.length < length) {
                    slice += ";";
                    slice = slice.padEnd(length - slice.length, "0");
                }
                setCurrentText(slice);
                index++;
            }
        }, speed);

        return () => clearInterval(intervalId);
    }, []);

    const mindim = Math.min(Dimensions.get('window').width, Dimensions.get('window').height);
    return (
        <View style={styles.container}>
            <Text>Displaying...</Text>
            {currentText === null ? <></> : (Platform.OS === "web" ? <QRCodeCanvas value={currentText} size={mindim/1.5}/> : <QRCode value={currentText} size={mindim/1.5}/>)}
            <TouchableOpacity>
                <Button title="Reset" onPress={() => navigation.goBack()} />
            </TouchableOpacity>
        </View>
    );
}

type ReceiveCompleteScreenProps = NativeStackScreenProps<RootStackParamList, "ReceiveCompleteScreen">;
function ReceiveCompleteScreen({ navigation, route }: ReceiveCompleteScreenProps) {

    let datatype: null|"image"|"text" = null;
    const extension = route.params.name.split(".").at(-1)!;
    switch (extension) {
        case "png":
        case "jpeg":
        case "jpg":
        case "webp":
        case "gif":
            datatype = "image";
            break;
        default:
            datatype = "text";
            break;
    }
    const decodedBytes = Buffer.from(route.params.data, "base64").toString();
    const receivedData = {
        index: 0,
        name: route.params.name,
        data: datatype === "image" ? `data:image/${extension};base64,${route.params.data}` : decodedBytes,
        type: datatype,
    };

    const [ isDownloading, setIsDownloading ] = React.useState<boolean>(false);
    const download = async () => {
        setIsDownloading(true);
        console.log("Clicked Download");
        console.log(documentDirectory);

        const filename = documentDirectory + receivedData.name;
        await writeAsStringAsync(filename, route.params.data, {
            encoding: EncodingType.Base64,
        }).then(() => {
            console.log(`saved file: ${filename}`);
            Sharing.shareAsync(filename);
        });

        setIsDownloading(false);
    }

    return (
        <View style={styles.container}>
            <Text>Result:</Text>
            {receivedData.type === "image" ? <>
                <Image style={{ flex: 1, width: "100%", height: "100%", resizeMode: "contain" }} source={{ uri: receivedData.data }}/>            
            </> : <>
                <TextInput style={{ flex: 1, width: "100%", height: "100%" }} multiline={true} editable={false} value={receivedData.data}/>
            </>}
            <Button title="Download"  disabled={isDownloading} onPress={isDownloading ? undefined : download}/>
        </View>
    );
}

type ReceiveScreenProps = NativeStackScreenProps<RootStackParamList, "ReceiveScreen">;
function ReceiveScreen({ navigation }: ReceiveScreenProps) {
    if (Platform.OS === "web") {
        return (
            <View style={styles.container}>
                <Text>Receiving is not supported on web</Text>
            </View>
        );
    }
    const [ hasPermission, setHasPermission ] = React.useState<boolean|null>(null);

    React.useEffect(() => {
        const getBarCodeScannerPermissions = async () => {
            const { status } = await BarCodeScanner.requestPermissionsAsync();
            setHasPermission(status === 'granted');
        };
        getBarCodeScannerPermissions();
    }, []);
    const [ isScanDone, setIsScanDone ] = React.useState<boolean>(false);

    const [ dataArray, setDataArray ] = React.useState<((string|null)[])|null>(null);
    const [ name, setName ] = React.useState<string|null>(null);
    const [ dataCount, setDataCount ] = React.useState<number>(0);
    const [ percentComplete, setPercentComplete ] = React.useState<number|null>(null);
    const handleBarCodeScanned = (scanResult: BarCodeScannerResult) => {
        const combinedFrags = scanResult.data;
        const frags = combinedFrags.split(";");
        if (!(frags.length === 4 || frags.length === 5)) {
            console.log("Did not receive four or five fragments");
            return;
        }
        const isMeta = frags[0] === "1";
        const nfrags = parseInt(frags[1]);
        const index = parseInt(frags[2]);
        const data = frags[3];
        if (dataArray === null) {
            const arr = new Array<string|null>(nfrags).fill(null);
            setDataArray(arr);
        }
        if (dataArray === null) {
            console.log("Error setting dataArray");
            return;
        }
        if (isMeta) {
            if (name === null) {
                setName(data);
            }
        } else {
            if (dataArray[index] === null) {
                dataArray[index] = data;
                setDataCount(dataCount + 1);
            }
        }
        const percentage = (dataCount + ((name !== null) ? 1 : 0))/(nfrags + 1)*100;
        console.log(`${percentage} has name ${name !== null}, ${dataCount + ((name !== null) ? 1 : 0)}/${nfrags + 1}`)
        setPercentComplete(percentage);
        if (percentage === 100) {
            setIsScanDone(true);
            navigation.navigate("ReceiveCompleteScreen", { data: dataArray.join(""), name: `${name!}` });
        }
    };

    if (hasPermission === null) {
        return (<View style={styles.container}><Text>Requesting for camera permission.</Text></View>);
    }
    if (hasPermission === false) {
        return (<View style={styles.container}><Text>No access to camera.</Text></View>);
    }

    return (
        <View style={styles.container}>
            <BarCodeScanner
                onBarCodeScanned={isScanDone ? undefined : handleBarCodeScanned}
                style={StyleSheet.absoluteFillObject}
            />
            <View style={{ height: 10, width: "100%", top: 0, position: "absolute" }}>
                <View style={{ height: "100%", width: `${percentComplete ?? 0}%`, backgroundColor: "red" }}></View>
            </View>
        </View>
    );
}

type HomeScreenProps = NativeStackScreenProps<RootStackParamList, "HomeScreen">;
function HomeScreen({ navigation }: HomeScreenProps) {
    return (
        <View style={styles.container}>
            <Text>Home Screen</Text>
            <Button title="Receive" onPress={() => navigation.push("ReceiveScreen")}/>
            <Button title="Transmit" onPress={() => navigation.push("TransmitScreenSelectFile")}/>
        </View>
    );
}

const Stack = createNativeStackNavigator<RootStackParamList>();
export default function App() {
    return (
        <NavigationContainer>
            <Stack.Navigator initialRouteName="HomeScreen">
                <Stack.Screen name="HomeScreen" component={HomeScreen} options={{ title: "Select an Option" }}/>
                <Stack.Screen name="ReceiveScreen" component={ReceiveScreen} options={{ title: "Receive Data" }}/>
                <Stack.Screen name="ReceiveCompleteScreen" component={ReceiveCompleteScreen} options={{ title: "Finished Receiving Data" }}/>
                <Stack.Screen name="TransmitScreenSelectFile" component={TransmitScreenSelectFile} options={{ title: "Transmit Data" }}/>
                <Stack.Screen name="TransmitScreenDisplaying" component={TransmitScreenDisplaying} options={{ title: "Transmit Data" }}/>
            </Stack.Navigator>
        </NavigationContainer>
    );
}
const styles = StyleSheet.create({
    container: {
        flex: 1,
        //backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
    },
});